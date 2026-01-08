import React, { useEffect, useMemo, useState } from "react";
import { ensureAnonAuth } from "../firebase";
import Home from "./Home.jsx";
import Room from "./Room.jsx";

export default function App(){
  const [user, setUser] = useState(null);
  const [route, setRoute] = useState(() => {
    const url = new URL(window.location.href);
    const roomId = url.searchParams.get("roomId");
    return roomId ? { page: "room", roomId } : { page: "home" };
  });

  useEffect(() => {
    (async () => {
      const u = await ensureAnonAuth();
      setUser(u);
    })();
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (route.page === "room") url.searchParams.set("roomId", route.roomId);
    else url.searchParams.delete("roomId");
    window.history.replaceState({}, "", url.toString());
  }, [route]);

  if (!user) {
    return (
      <div className="container">
        <div className="shell">
          <div className="hero">
            <div className="brandMark">📘</div>
            <div>
              <h1 style={{ margin: 0 }}>The Dictionary</h1>
              <div className="muted">Signing you in…</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (route.page === "room") {
    return <Room uid={user.uid} roomId={route.roomId} onExit={() => setRoute({ page: "home" })} />;
  }

  return <Home uid={user.uid} onEnterRoom={(roomId) => setRoute({ page: "room", roomId })} />;
}
