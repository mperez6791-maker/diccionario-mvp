import { nanoid } from "nanoid";
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, onSnapshot,
  query, where, serverTimestamp, runTransaction, increment
} from "firebase/firestore";
import { db } from "../firebase";
import { formatRoomCode, pickRandom, shuffle } from "./util";
import WORDS from "../data/words_pack_core.json";

const PHASE = {
  LOBBY: "lobby",
  WORD_SELECT: "word_select",
  REVIEW: "review",
  WRITING: "writing",
  VOTING: "voting",
  REVEAL: "reveal",
  FINISHED: "finished",
};

export { PHASE };

function makeRoomCode(){
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i=0;i<6;i++) code += alphabet[Math.floor(Math.random()*alphabet.length)];
  return code;
}

function wordForLang(wordEntry, lang){
  if (lang === "es") return { word: wordEntry.es.word, def: wordEntry.es.def, lang: "es" };
  return { word: wordEntry.en.word, def: wordEntry.en.def, lang: "en" };
}

function chooseLang(mode, roundIndex){
  // mode: "both" -> alternate ES/EN for variety
  if (mode === "es" || mode === "en") return mode;
  return (roundIndex % 2 === 0) ? "es" : "en";
}

export async function createRoom({ hostUid, hostName, targetScore=15, langMode="en", gameMode="classic" }){
  const code = makeRoomCode();
  const roomId = nanoid(10);
  const roomRef = doc(db, "rooms", roomId);

  await setDoc(roomRef, {
    code,
    status: PHASE.LOBBY,
    hostUid,
    targetScore,
    langMode,
    gameMode,
    // v6A: in classic mode, reader gets 5 words to choose from each round.
    readerChoiceEnabled: gameMode === "classic",
    roundIndex: 0,
    readerIndex: 0,
    playerOrder: [hostUid],
    usedWordIds: [],
    gameOver: false,
    winnerUid: null,
    createdAt: serverTimestamp(),
    lastUpdatedAt: serverTimestamp(),
  });

  const playerRef = doc(db, "rooms", roomId, "players", hostUid);
  await setDoc(playerRef, {
    name: hostName,
    score: 0,
    joinedAt: serverTimestamp(),
    isConnected: true,
  });

  return { roomId, code };
}

export async function joinRoomByCode({ code, uid, name }){
  const clean = formatRoomCode(code);
  const roomsCol = collection(db, "rooms");
  const q = query(roomsCol, where("code", "==", clean));
  const snap = await getDocs(q);
  if (snap.empty) throw new Error("Room not found");

  const roomDoc = snap.docs[0];
  const roomId = roomDoc.id;
  const roomRef = doc(db, "rooms", roomId);

  await runTransaction(db, async (tx) => {
    const room = await tx.get(roomRef);
    if (!room.exists()) throw new Error("Room not found");
    const data = room.data();

    if (data.status !== PHASE.LOBBY) {
      // allow late join for MVP? We'll block to keep it simple.
      throw new Error("Game already started (for MVP, join only in lobby).");
    }

    const playerRef = doc(db, "rooms", roomId, "players", uid);
    const playerSnap = await tx.get(playerRef);

    if (!playerSnap.exists()){
      tx.set(playerRef, { name, score: 0, joinedAt: serverTimestamp(), isConnected: true });
      tx.update(roomRef, {
        playerOrder: [...(data.playerOrder || []), uid],
        lastUpdatedAt: serverTimestamp(),
      });
    } else {
      tx.update(playerRef, { name, isConnected: true });
    }
  });

  return { roomId };
}

export function subscribeRoom(roomId, cb){
  const roomRef = doc(db, "rooms", roomId);
  return onSnapshot(roomRef, (snap) => cb(snap.exists() ? snap.data() : null));
}

export function subscribePlayers(roomId, cb){
  const colRef = collection(db, "rooms", roomId, "players");
  return onSnapshot(colRef, (snap) => {
    const players = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    cb(players);
  });
}

export function subscribeRound(roomId, roundId, cb){
  const ref = doc(db, "rooms", roomId, "rounds", roundId);
  return onSnapshot(ref, (snap) => cb(snap.exists() ? ({ id: snap.id, ...snap.data() }) : null));
}

export function subscribeSubmissions(roomId, roundId, cb){
  const colRef = collection(db, "rooms", roomId, "rounds", roundId, "submissions");
  return onSnapshot(colRef, (snap) => {
    const subs = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    cb(subs);
  });
}

export function subscribeVotes(roomId, roundId, cb){
  const colRef = collection(db, "rooms", roomId, "rounds", roundId, "votes");
  return onSnapshot(colRef, (snap) => {
    const votes = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    cb(votes);
  });
}

export async function startGame(roomId, hostUid){
  const roomRef = doc(db, "rooms", roomId);
  await runTransaction(db, async (tx) => {
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists()) throw new Error("Room not found");
    const room = roomSnap.data();
    if (room.hostUid !== hostUid) throw new Error("Only host can start");
    if (room.status !== PHASE.LOBBY) return;

    // Round creation will set the correct status.
    tx.update(roomRef, { lastUpdatedAt: serverTimestamp() });
  });
  // create first round
  await createNextRound(roomId);
}

export async function createNextRound(roomId){
  const roomRef = doc(db, "rooms", roomId);

  await runTransaction(db, async (tx) => {
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists()) throw new Error("Room not found");
    const room = roomSnap.data();

    const playerOrder = room.playerOrder || [];
    if (playerOrder.length < 2) throw new Error("Need at least 2 players");

    const roundIndex = room.roundIndex || 0;
    const readerIndex = room.readerIndex || 0;
    const gameMode = room.gameMode || "classic"; // "classic" | "no_reader"
    const readerUid = (gameMode === "classic") ? playerOrder[readerIndex % playerOrder.length] : null;

    const lang = chooseLang(room.langMode || "both", roundIndex);

    // Avoid repeating words within the same room until we exhaust the pack.
    const used = Array.isArray(room.usedWordIds) ? room.usedWordIds : [];
    const unused = WORDS.filter(w => !used.includes(w.id));
    const poolReset = unused.length === 0;
    const pool = unused.length ? unused : WORDS;

    const candidates = shuffle(pool).slice(0, Math.min(5, pool.length));
    const wordCandidates = candidates.map(w => ({ id: w.id, word: wordForLang(w, lang).word }));

    const roundsCol = collection(db, "rooms", roomId, "rounds");
    const roundId = `r${roundIndex+1}`;

    const roundRef = doc(roundsCol, roundId);
    // No-reader mode: system picks a word immediately and everyone writes.
    if (gameMode === "no_reader"){
      const chosen = candidates[0] || pickRandom(pool);
      const wd = wordForLang(chosen, lang);
      tx.set(roundRef, {
        roundIndex: roundIndex + 1,
        readerUid: null,
        wordId: chosen.id,
        word: wd.word,
        realDefinition: wd.def,
        lang,
        phase: PHASE.WRITING,
        wordCandidates: [],
        poolReset,
        createdAt: serverTimestamp(),
      });

      const nextUsed = (!poolReset ? [...used, chosen.id] : [chosen.id]);
      tx.update(roomRef, {
        status: PHASE.WRITING,
        roundIndex: roundIndex + 1,
        readerIndex: (readerIndex + 1) % playerOrder.length,
        currentRoundId: roundId,
        usedWordIds: nextUsed,
        lastUpdatedAt: serverTimestamp(),
      });
      return;
    }

    // Classic mode: reader chooses the word.
    tx.set(roundRef, {
      roundIndex: roundIndex + 1,
      readerUid,
      wordId: null,
      word: null,
      realDefinition: null,
      lang,
      phase: (room.readerChoiceEnabled ?? true) ? PHASE.WORD_SELECT : PHASE.WRITING,
      wordCandidates,
      poolReset,
      createdAt: serverTimestamp(),
    });

    // If readerChoiceEnabled is OFF, immediately pick one.
    if (!(room.readerChoiceEnabled ?? true)){
      const chosen = candidates[0] || pickRandom(pool);
      const wd = wordForLang(chosen, lang);
      tx.update(roundRef, {
        wordId: chosen.id,
        word: wd.word,
        realDefinition: wd.def,
        phase: PHASE.WRITING,
      });

      const nextUsed = (!poolReset ? [...used, chosen.id] : [chosen.id]);
      tx.update(roomRef, {
        status: PHASE.WRITING,
        roundIndex: roundIndex + 1,
        readerIndex: (readerIndex + 1) % playerOrder.length,
        currentRoundId: roundId,
        usedWordIds: nextUsed,
        lastUpdatedAt: serverTimestamp(),
      });
      return;
    }

    tx.update(roomRef, {
      status: PHASE.WORD_SELECT,
      roundIndex: roundIndex + 1,
      readerIndex: (readerIndex + 1) % playerOrder.length,
      currentRoundId: roundId,
      lastUpdatedAt: serverTimestamp(),
    });
  });
}

export async function chooseWordForRound(roomId, roundId, actorUid, chosenWordId){
  const roomRef = doc(db, "rooms", roomId);
  const roundRef = doc(db, "rooms", roomId, "rounds", roundId);
  await runTransaction(db, async (tx) => {
    const roomSnap = await tx.get(roomRef);
    const roundSnap = await tx.get(roundRef);
    if (!roomSnap.exists() || !roundSnap.exists()) throw new Error("Missing room/round");
    const room = roomSnap.data();
    const round = roundSnap.data();
    if (round.readerUid !== actorUid) throw new Error("Only the reader can choose the word");
    if (round.phase !== PHASE.WORD_SELECT) return;

    // round.lang is always a concrete language: "es" or "en"
    const lang = (round.lang === "es" || round.lang === "en") ? round.lang : "en";
    const cand = (round.wordCandidates || []).find(c => c.id === chosenWordId);
    if (!cand) throw new Error("Invalid word choice");

    const entry = WORDS.find(w => w.id === chosenWordId);
    if (!entry) throw new Error("Word not found");
    const wd = wordForLang(entry, lang);

    // Update usedWordIds only when a word is actually selected.
    const used = Array.isArray(room.usedWordIds) ? room.usedWordIds : [];
    const nextUsed = (round.poolReset ? [chosenWordId] : [...used, chosenWordId]);

    tx.update(roundRef, {
      wordId: chosenWordId,
      word: wd.word,
      realDefinition: wd.def,
      phase: PHASE.WRITING,
      chosenAt: serverTimestamp(),
    });

    tx.update(roomRef, {
      status: PHASE.WRITING,
      usedWordIds: nextUsed,
      lastUpdatedAt: serverTimestamp(),
    });
  });
}

export async function submitDefinition(roomId, roundId, uid, text){
  const ref = doc(db, "rooms", roomId, "rounds", roundId, "submissions", uid);
  await setDoc(ref, { text: (text || "").trim(), submittedAt: serverTimestamp() }, { merge: true });
}

export async function openReaderReview(roomId, roundId, actorUid){
  const roomRef = doc(db, "rooms", roomId);
  const roundRef = doc(db, "rooms", roomId, "rounds", roundId);
  await runTransaction(db, async (tx) => {
    const roomSnap = await tx.get(roomRef);
    const roundSnap = await tx.get(roundRef);
    if (!roomSnap.exists() || !roundSnap.exists()) throw new Error("Missing room/round");
    const room = roomSnap.data();
    const round = roundSnap.data();
    if ((room.gameMode || "classic") !== "classic") throw new Error("Review is only for classic mode.");
    if (round.readerUid !== actorUid) throw new Error("Only the reader can review");
    if (round.phase !== PHASE.WRITING) return;

    tx.update(roundRef, { phase: PHASE.REVIEW, reviewStartedAt: serverTimestamp() });
    tx.update(roomRef, { status: PHASE.REVIEW, lastUpdatedAt: serverTimestamp() });
  });
}

export async function openVoting(roomId, roundId, actorUid){
  const roomRef = doc(db, "rooms", roomId);
  const roundRef = doc(db, "rooms", roomId, "rounds", roundId);
  await runTransaction(db, async (tx) => {
    const roomSnap = await tx.get(roomRef);
    const roundSnap = await tx.get(roundRef);
    if (!roomSnap.exists() || !roundSnap.exists()) throw new Error("Missing room/round");
    const room = roomSnap.data();
    const round = roundSnap.data();
    const mode = room.gameMode || "classic";
    const isClassic = mode === "classic";

    const canOpen = isClassic
      ? (round.readerUid === actorUid)
      : (room.hostUid === actorUid);
    if (!canOpen) throw new Error(isClassic ? "Only the reader can open voting" : "Only the host can open voting");

    // Classic: prefer going through REVIEW, but allow skipping for MVP.
    if (isClassic){
      if (round.phase !== PHASE.REVIEW && round.phase !== PHASE.WRITING) return;
    } else {
      if (round.phase !== PHASE.WRITING) return;
    }

    tx.update(roundRef, { phase: PHASE.VOTING, votingOpenedAt: serverTimestamp() });
    tx.update(roomRef, { status: PHASE.VOTING, lastUpdatedAt: serverTimestamp() });
  });
}

export async function castVote(roomId, roundId, uid, choiceId){
  // Guard: can't vote for your own fake
  if (choiceId === uid) throw new Error("You can't vote for your own definition.");

  const roomSnap = await getDoc(doc(db, "rooms", roomId));
  const roundSnap = await getDoc(doc(db, "rooms", roomId, "rounds", roundId));
  const mode = roomSnap.exists() ? (roomSnap.data()?.gameMode || "classic") : "classic";
  if (mode === "classic" && roundSnap.exists() && roundSnap.data()?.readerUid === uid){
    throw new Error("Reader cannot vote this round.");
  }
  const ref = doc(db, "rooms", roomId, "rounds", roundId, "votes", uid);
  await setDoc(ref, { choiceId, votedAt: serverTimestamp() }, { merge: true });
}
export async function revealAndScore(roomId, roundId, actorUid){
  // Controller computes options, checks votes, updates scores.
  const roomRef = doc(db, "rooms", roomId);
  const roundRef = doc(db, "rooms", roomId, "rounds", roundId);

  await runTransaction(db, async (tx) => {
    const roomSnap = await tx.get(roomRef);
    const roundSnap = await tx.get(roundRef);
    if (!roomSnap.exists() || !roundSnap.exists()) throw new Error("Missing room/round");
    const room = roomSnap.data();
    const round = roundSnap.data();
    const mode = room.gameMode || "classic";
    const isClassic = mode === "classic";
    const canReveal = isClassic ? (round.readerUid === actorUid) : (room.hostUid === actorUid);
    if (!canReveal) throw new Error(isClassic ? "Only the reader can reveal/score" : "Only the host can reveal/score");
    if (round.phase !== PHASE.VOTING) return;

    const subsCol = collection(db, "rooms", roomId, "rounds", roundId, "submissions");
    const votesCol = collection(db, "rooms", roomId, "rounds", roundId, "votes");
    const subsSnap = await getDocs(subsCol);
    const votesSnap = await getDocs(votesCol);

    const submissions = subsSnap.docs.map(d => ({ uid: d.id, ...d.data() }))
      .filter(s => (s.text || "").trim().length > 0);

    const votes = votesSnap.docs.map(d => ({ uid: d.id, ...d.data() }));

    // Build option list: real + all fake submissions.
    const realChoiceId = "REAL";
    const fake = submissions
      .filter(s => !isClassic || s.uid !== round.readerUid) // classic: ignore reader submissions (shouldn't happen)
      .map(s => ({ choiceId: s.uid, authorUid: s.uid, text: s.text }));
    const options = shuffle([{ choiceId: realChoiceId, authorUid: null, text: round.realDefinition }, ...fake]);

    // Score rules:
    // +2 for choosing real
    // +1 for each vote your fake definition receives
    // reader (classic only) gets +1 for each player who did NOT choose real
    let realVotes = 0;

    for (const v of votes){
      if (v.choiceId === realChoiceId) realVotes += 1;
      // give +2 to voter if real
      if (v.choiceId === realChoiceId){
        const pRef = doc(db, "rooms", roomId, "players", v.uid);
        tx.update(pRef, { score: increment(2) });
      }
      // give +1 to author if vote matches fake
      const votedFake = fake.find(f => f.choiceId === v.choiceId);
      if (votedFake && votedFake.authorUid){
        const authorRef = doc(db, "rooms", roomId, "players", votedFake.authorUid);
        tx.update(authorRef, { score: increment(1) });
      }
    }

    if (isClassic){
      const totalVoters = votes.length;
      const readerBonus = Math.max(0, totalVoters - realVotes);
      if (readerBonus > 0){
        const readerRef = doc(db, "rooms", roomId, "players", round.readerUid);
        tx.update(readerRef, { score: increment(readerBonus) });
      }
    }

    tx.update(roundRef, {
      phase: PHASE.REVEAL,
      options,
      realChoiceId,
      scoredAt: serverTimestamp(),
    });
    tx.update(roomRef, { status: PHASE.REVEAL, lastUpdatedAt: serverTimestamp() });
  });

  // After scoring, check whether the game is over and set winner immediately.
  await checkAndSetGameOver(roomId);
}

async function checkAndSetGameOver(roomId){
  const roomRef = doc(db, "rooms", roomId);
  const roomSnap = await getDoc(roomRef);
  if (!roomSnap.exists()) return;
  const room = roomSnap.data();
  if (room.gameOver) return;
  const target = room.targetScore ?? 15;

  const playersSnap = await getDocs(collection(db, "rooms", roomId, "players"));
  let winnerUid = null;
  let top = -1;
  playersSnap.docs.forEach(d => {
    const p = d.data();
    const sc = p.score ?? 0;
    if (sc > top){ top = sc; winnerUid = d.id; }
  });

  if (top >= target){
    await runTransaction(db, async (tx) => {
      const r = await tx.get(roomRef);
      if (!r.exists()) return;
      const cur = r.data();
      if (cur.gameOver) return;
      tx.update(roomRef, { gameOver: true, winnerUid: winnerUid || null, lastUpdatedAt: serverTimestamp() });
    });
  }
}

export async function finishGame(roomId, actorUid){
  const roomRef = doc(db, "rooms", roomId);
  await runTransaction(db, async (tx) => {
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists()) throw new Error("Room not found");
    const room = roomSnap.data();
    const mode = room.gameMode || "classic";
    const currentRoundId = room.currentRoundId;
    let readerUid = null;
    if (currentRoundId){
      const rSnap = await tx.get(doc(db, "rooms", roomId, "rounds", currentRoundId));
      readerUid = rSnap.exists() ? rSnap.data()?.readerUid : null;
    }
    const can = (mode === "classic") ? (actorUid === readerUid || actorUid === room.hostUid) : (actorUid === room.hostUid);
    if (!can) throw new Error("Only the game controller can finish the game.");
    tx.update(roomRef, { status: PHASE.FINISHED, lastUpdatedAt: serverTimestamp() });
  });
}

export async function nextOrFinish(roomId, actorUid){
  const roomRef = doc(db, "rooms", roomId);

  const roomSnap = await getDoc(roomRef);
  if (!roomSnap.exists()) throw new Error("Room not found");
  const room = roomSnap.data();
  // If game over, don't create new rounds.
  if (room.gameOver) return { finished: true };

  // Reader (of the current round) advances. Host is also allowed as a fallback (MVP).
  const currentRoundId = room.currentRoundId;
  let currentReaderUid = null;
  if (currentRoundId){
    const rSnap = await getDoc(doc(db, "rooms", roomId, "rounds", currentRoundId));
    currentReaderUid = rSnap.exists() ? rSnap.data()?.readerUid : null;
  }

  const mode = room.gameMode || "classic";
  const canAdvance = (mode === "classic")
    ? (actorUid === room.hostUid || (currentReaderUid && actorUid === currentReaderUid))
    : (actorUid === room.hostUid);
  if (!canAdvance) throw new Error(mode === "classic" ? "Only the reader can advance to the next round." : "Only the host can advance to the next round.");

  await createNextRound(roomId);
  return { finished: false };
}
