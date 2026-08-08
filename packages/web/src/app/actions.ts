"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { approveRun, cancelRun, createRun } from "@/lib/control";

/**
 * Server actions are the only writes the dashboard performs, and each one is a
 * thin call into the worker's control API. Returning `{ error }` rather than
 * throwing keeps a rejected approval — which is the gate working correctly —
 * from rendering as a crashed page.
 */

export interface ActionState {
  error: string | null;
}

export async function startRunAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const query = String(formData.get("query") ?? "").trim();
  if (!query) return { error: "Describe the companies you want to find." };

  const { data, error } = await createRun(query);
  if (error || !data) return { error: error ?? "the worker returned no run" };

  redirect(`/runs/${data.runId}`);
}

export async function approveRunAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const runId = String(formData.get("runId") ?? "");
  const { error } = await approveRun(runId);
  revalidatePath(`/runs/${runId}`);
  return { error };
}

export async function cancelRunAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const runId = String(formData.get("runId") ?? "");
  const { error } = await cancelRun(runId);
  revalidatePath(`/runs/${runId}`);
  return { error };
}
