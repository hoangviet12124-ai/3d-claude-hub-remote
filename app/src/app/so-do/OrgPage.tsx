"use client";

import { useEffect, useState } from "react";
import { OrgBoard } from "@/components/org/OrgBoard";
import { connectBackend } from "@/integrations/backendClient";

/** `?mode=wall`: the desktop wallpaper version (English names, no task texts). */
export function OrgPage() {
  const [wall, setWall] = useState(false);
  useEffect(() => {
    // Read after mount: the page is prerendered, so the first render must match the server's.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWall(new URLSearchParams(window.location.search).get("mode") === "wall");
    return connectBackend();
  }, []);
  return <OrgBoard variant={wall ? "wall" : "full"} />;
}
