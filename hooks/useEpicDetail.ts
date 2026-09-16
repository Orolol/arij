"use client";

import { useTranslations } from "next-intl";

import { usePolledResource } from "@/hooks/usePolledResource";
import { useScopedMutation } from "@/hooks/useScopedMutation";
import { requestJson } from "@/lib/api/client";
import type { GradingReportData } from "@/lib/grading/report";
import {
  isVerificationReport,
  type VerificationReport,
} from "@/lib/verify/verify-constants";
import { useCallback, useState } from "react";
interface UserStory {
  id: string;
  epicId: string;
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
  status: string;
  position: number;
  createdAt: string;
}

interface EpicDetail {
  id: string;
  title: string;
  description: string | null;
  priority: number;
  status: string;
  branchName: string | null;
  prNumber: number | null;
  prUrl: string | null;
  prStatus: string | null;
  type: string;
  linkedEpicId: string | null;
  images: string | null;
  readableId: string | null;
  createdAt: string | null;
  updatedAt: string | null;

}

interface DetailState {
  epic: EpicDetail | null;
  userStories: UserStory[];
  gradingReport: GradingReportData | null;
}

export function useEpicDetail(projectId: string, epicId: string | null) {
  const tErrors = useTranslations("ClientErrors");
  const target = projectId && epicId ? `/api/projects/${projectId}/epics/${epicId}` : null;
  const [polling, setPolling] = useState(false);
  const errorMessage = useCallback(() => tErrors("networkErrorTheUpdateWasNotApplied"), [tErrors]);
  const detail = usePolledResource<DetailState>(target, polling ? 5000 : null, errorMessage);
  const verification = usePolledResource<VerificationReport | null>(target ? `${target}/verify` : null, null, errorMessage, {
    validateData: isNullableVerification,
  });
  const mutation = useScopedMutation(target);
  const { updateData: detailUpdateData } = detail;
  const { refresh: detailRefresh } = detail;
  const { refresh: verificationRefresh } = verification;
  const { run: mutationRun } = mutation;
  const refresh = useCallback(async () => {
    await Promise.all([detailRefresh(), verificationRefresh()]);
  }, [detailRefresh, verificationRefresh]);
  const setVerificationReport = verification.updateData;
  const updateEpic = useCallback(async (updates: Partial<EpicDetail>): Promise<{ ok: boolean; error?: string }> => {
    if (!target) return { ok: false, error: tErrors("noTicketSelected") };
    const result = await mutationRun(async () => {
      const result = await requestJson<EpicDetail>(target, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates),
        errorMessage: tErrors("theUpdateWasRejected"),
      });
      if (result.error) throw new Error(result.error);
      return result.data;
    }, tErrors("theUpdateWasRejected"));
    if (!result) return { ok: false, error: tErrors("theUpdateWasRejected") };
    detailUpdateData((previous) => ({
      epic: { ...(previous?.epic ?? result), ...result },
      userStories: previous?.userStories ?? [], gradingReport: previous?.gradingReport ?? null,
    }));
    return { ok: true };
  }, [target, mutationRun, detailUpdateData, tErrors]);
  return {
    epic: detail.data?.epic ?? null, userStories: detail.data?.userStories ?? [],
    gradingReport: detail.data?.gradingReport ?? null, verificationReport: verification.data,
    loading: detail.loading, error: detail.error ?? verification.error,
    updateEpic, refresh, setVerificationReport, setPolling,
  };
}

function isNullableVerification(value: unknown): value is VerificationReport | null {
  return value === null || isVerificationReport(value);
}
