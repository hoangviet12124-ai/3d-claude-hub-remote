"use client";
// Which model a web-run session uses and how hard it thinks. "Theo cài đặt" leaves both to Claude Code's settings
// (the Brainstorm vault and the user settings). The last pick is remembered in this browser.
import { Cpu } from "lucide-react";
import { SESSION_EFFORTS, SESSION_MODELS } from "@/integrations/AgentBackend";
import type { SessionEffort, SessionModel } from "@/integrations/AgentBackend";

export const MODEL_LABEL: Record<SessionModel, string> = { sonnet: "Sonnet", opus: "Opus", haiku: "Haiku" };
export const EFFORT_LABEL: Record<SessionEffort, string> = { low: "Thấp", medium: "Vừa", high: "Cao", xhigh: "Rất cao", max: "Tối đa" };

const KEY = "aaw.modelPick.v1";

export interface ModelPick {
  model?: SessionModel;
  effort?: SessionEffort;
}

export function rememberedPick(): ModelPick {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as ModelPick;
    return {
      ...(v.model && (SESSION_MODELS as readonly string[]).includes(v.model) ? { model: v.model } : {}),
      ...(v.effort && (SESSION_EFFORTS as readonly string[]).includes(v.effort) ? { effort: v.effort } : {}),
    };
  } catch {
    return {};
  }
}

function remember(p: ModelPick): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // storage blocked
  }
}

export function ModelPicker({ value, onChange, disabled, id, effortNote }: { value: ModelPick; onChange: (p: ModelPick) => void; disabled?: boolean; id: string; effortNote?: string | null }) {
  const set = (p: ModelPick) => {
    remember(p);
    onChange(p);
  };
  return (
    <div className="flex flex-col gap-1" data-testid="model-picker">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="flex flex-none items-center gap-1 text-[11.5px] text-mist-500">
          <Cpu size={13} aria-hidden /> Model
        </label>
        <select
          id={id}
          className="field min-w-0 flex-1 py-1 text-[12.5px]"
          value={value.model ?? ""}
          onChange={(e) => set({ ...value, model: (e.target.value || undefined) as SessionModel | undefined })}
          disabled={disabled}
          title="Model cho việc này. Theo cài đặt: dùng model ghi trong cài đặt Claude Code."
          data-testid="model-select"
        >
          <option value="">Theo cài đặt</option>
          {SESSION_MODELS.map((m) => (
            <option key={m} value={m}>
              {MODEL_LABEL[m]}
            </option>
          ))}
        </select>
        <select
          aria-label="Mức suy nghĩ"
          className="field min-w-0 flex-1 py-1 text-[12.5px]"
          value={value.effort ?? ""}
          onChange={(e) => set({ ...value, effort: (e.target.value || undefined) as SessionEffort | undefined })}
          disabled={disabled}
          title="Mức suy nghĩ: càng cao càng kỹ nhưng tốn hạn mức và lâu hơn."
          data-testid="effort-select"
        >
          <option value="">Suy nghĩ: theo cài đặt</option>
          {SESSION_EFFORTS.map((e) => (
            <option key={e} value={e}>
              Suy nghĩ: {EFFORT_LABEL[e]}
            </option>
          ))}
        </select>
      </div>
      {effortNote ? <p className="text-[11px] leading-snug text-mist-500">{effortNote}</p> : null}
    </div>
  );
}
