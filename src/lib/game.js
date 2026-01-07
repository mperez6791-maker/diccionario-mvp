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

export async function createRoom({ hostUid, hostName, targetScore=50, langMode="both" }){
  const code = makeRoomCode();
  const roomId = nanoid(10);
  const roomRef = doc(db, "rooms", roomId);

  await setDoc(roomRef, {
    code,
    status: PHASE.LOBBY,
    hostUid,
    targetScore,
    langMode,
    roundIndex: 0,
    readerIndex: 0,
    playerOrder: [hostUid],
    usedWordIds: [],
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

    tx.update(roomRef, { status: PHASE.WRITING, lastUpdatedAt: serverTimestamp() });
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
    const readerUid = playerOrder[readerIndex % playerOrder.length];

    const lang = chooseLang(room.langMode || "both", roundIndex);

    // Avoid repeating words within the same room until we exhaust the pack.
    const used = Array.isArray(room.usedWordIds) ? room.usedWordIds : [];
    const unused = WORDS.filter(w => !used.includes(w.id));
    const pool = unused.length ? unused : WORDS;
    const chosen = pickRandom(pool);
    const wd = wordForLang(chosen, lang);

    const roundsCol = collection(db, "rooms", roomId, "rounds");
    const roundId = `r${roundIndex+1}`;

    const roundRef = doc(roundsCol, roundId);
    tx.set(roundRef, {
      roundIndex: roundIndex + 1,
      readerUid,
      wordId: chosen.id,
      word: wd.word,
      realDefinition: wd.def,
      lang: wd.lang,
      phase: PHASE.WRITING,
      createdAt: serverTimestamp(),
    });

    const nextUsed = (unused.length ? [...used, chosen.id] : [chosen.id]);

    tx.update(roomRef, {
      status: PHASE.WRITING,
      roundIndex: roundIndex + 1,
      readerIndex: (readerIndex + 1) % playerOrder.length,
      currentRoundId: roundId,
      usedWordIds: nextUsed,
      lastUpdatedAt: serverTimestamp(),
    });
  });
}

export async function submitDefinition(roomId, roundId, uid, text){
  const ref = doc(db, "rooms", roomId, "rounds", roundId, "submissions", uid);
  await setDoc(ref, { text: (text || "").trim(), submittedAt: serverTimestamp() }, { merge: true });
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
    if (round.readerUid !== actorUid) throw new Error("Only the reader can open voting");
    if (round.phase !== PHASE.WRITING) return;

    tx.update(roundRef, { phase: PHASE.VOTING });
    tx.update(roomRef, { status: PHASE.VOTING, lastUpdatedAt: serverTimestamp() });
  });
}

export async function castVote(roomId, roundId, uid, choiceId){
  // MVP guard: reader doesn't vote
  const roundSnap = await getDoc(doc(db, "rooms", roomId, "rounds", roundId));
  if (roundSnap.exists() && roundSnap.data()?.readerUid === uid){
    throw new Error("Reader cannot vote this round.");
  }
  const ref = doc(db, "rooms", roomId, "rounds", roundId, "votes", uid);
  await setDoc(ref, { choiceId, votedAt: serverTimestamp() }, { merge: true });
}
export async function revealAndScore(roomId, roundId, actorUid){
  // Reader computes options, checks votes, updates scores.
  const roomRef = doc(db, "rooms", roomId);
  const roundRef = doc(db, "rooms", roomId, "rounds", roundId);

  await runTransaction(db, async (tx) => {
    const roomSnap = await tx.get(roomRef);
    const roundSnap = await tx.get(roundRef);
    if (!roomSnap.exists() || !roundSnap.exists()) throw new Error("Missing room/round");
    const room = roomSnap.data();
    const round = roundSnap.data();
    if (round.readerUid !== actorUid) throw new Error("Only the reader can reveal/score");
    if (round.phase !== PHASE.VOTING) return;

    const subsCol = collection(db, "rooms", roomId, "rounds", roundId, "submissions");
    const votesCol = collection(db, "rooms", roomId, "rounds", roundId, "votes");
    const subsSnap = await getDocs(subsCol);
    const votesSnap = await getDocs(votesCol);

    const submissions = subsSnap.docs.map(d => ({ uid: d.id, ...d.data() }))
      .filter(s => (s.text || "").trim().length > 0);

    const votes = votesSnap.docs.map(d => ({ uid: d.id, ...d.data() }));

    // Build option list: real + all fake submissions EXCEPT reader's submission (reader shouldn't submit)
    const realChoiceId = "REAL";
    const fake = submissions.map(s => ({ choiceId: s.uid, authorUid: s.uid, text: s.text }));
    const options = shuffle([{ choiceId: realChoiceId, authorUid: null, text: round.realDefinition }, ...fake]);

    // Score rules:
    // +2 for choosing real
    // +1 for each vote your fake definition receives
    // reader gets +1 for each player who did NOT choose real
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

    const totalVoters = votes.length;
    const readerBonus = Math.max(0, totalVoters - realVotes);
    if (readerBonus > 0){
      const readerRef = doc(db, "rooms", roomId, "players", round.readerUid);
      tx.update(readerRef, { score: increment(readerBonus) });
    }

    tx.update(roundRef, {
      phase: PHASE.REVEAL,
      options,
      realChoiceId,
      scoredAt: serverTimestamp(),
    });
    tx.update(roomRef, { status: PHASE.REVEAL, lastUpdatedAt: serverTimestamp() });
  });
}

export async function nextOrFinish(roomId, actorUid){
  const roomRef = doc(db, "rooms", roomId);

  // decide if anyone reached targetScore
  const playersSnap = await getDocs(collection(db, "rooms", roomId, "players"));
  let winner = null;
  let top = -1;
  playersSnap.docs.forEach(d => {
    const p = d.data();
    if ((p.score ?? 0) > top){
      top = p.score ?? 0;
      winner = { uid: d.id, ...p };
    }
  });

  const roomSnap = await getDoc(roomRef);
  const target = roomSnap.data()?.targetScore ?? 50;

  // Reader (of the current round) advances. Host is also allowed as a fallback (MVP).
  const currentRoundId = roomSnap.data()?.currentRoundId;
  let currentReaderUid = null;
  if (currentRoundId){
    const rSnap = await getDoc(doc(db, "rooms", roomId, "rounds", currentRoundId));
    currentReaderUid = rSnap.exists() ? rSnap.data()?.readerUid : null;
  }

  const canAdvance = actorUid === roomSnap.data()?.hostUid || (currentReaderUid && actorUid === currentReaderUid);
  if (!canAdvance) throw new Error("Only the reader can advance to the next round.");

  if (top >= target){
    await runTransaction(db, async (tx) => {
      const r = await tx.get(roomRef);
      if (!r.exists()) return;
      tx.update(roomRef, { status: PHASE.FINISHED, winnerUid: winner?.uid || null, lastUpdatedAt: serverTimestamp() });
    });
    return { finished: true, winner };
  }

  await createNextRound(roomId);
  return { finished: false };
}
