"use client";

import { useEffect } from "react";
import { OrgBoard } from "@/components/org/OrgBoard";
import { connectBackend } from "@/integrations/backendClient";

export function OrgPage() {
  useEffect(() => connectBackend(), []);
  return <OrgBoard variant="full" />;
}
