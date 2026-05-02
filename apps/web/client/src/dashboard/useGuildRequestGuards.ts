import { useEffect, useRef } from "react";
import type { ClaimStatus } from "../api.js";

export class StaleGuildRequestError extends Error {}

export const useGuildRequestGuards = ({
    claimStatus,
    selectedGuildId,
}: {
    claimStatus: ClaimStatus;
    selectedGuildId: string;
}) => {
    const selectedGuildIdRef = useRef("");
    const claimStatusRef = useRef<ClaimStatus>("pending");
    const guildLoadRequestRef = useRef(0);
    const claimLoadRequestRef = useRef(0);

    useEffect(() => {
        selectedGuildIdRef.current = selectedGuildId;
    }, [selectedGuildId]);

    useEffect(() => {
        claimStatusRef.current = claimStatus;
    }, [claimStatus]);

    const invalidateGuildRequests = (guildId: string) => {
        selectedGuildIdRef.current = guildId;
        guildLoadRequestRef.current += 1;
        claimLoadRequestRef.current += 1;
        return guildLoadRequestRef.current;
    };

    const assertCurrentGuildRequest = (requestId: number, guildId: string) => {
        if (guildLoadRequestRef.current !== requestId || selectedGuildIdRef.current !== guildId) {
            throw new StaleGuildRequestError();
        }
    };

    const assertCurrentGuild = (guildId: string) => {
        if (selectedGuildIdRef.current !== guildId) {
            throw new StaleGuildRequestError();
        }
    };

    const startClaimRequest = () => {
        claimLoadRequestRef.current += 1;
        return claimLoadRequestRef.current;
    };

    const isClaimStatusCurrent = (status: ClaimStatus) => claimStatusRef.current === status;

    const isCurrentClaimRequest = (
        requestId: number,
        guildId: string,
        status: ClaimStatus,
    ) =>
        claimLoadRequestRef.current === requestId &&
        selectedGuildIdRef.current === guildId &&
        claimStatusRef.current === status;

    return {
        assertCurrentGuild,
        assertCurrentGuildRequest,
        invalidateGuildRequests,
        isClaimStatusCurrent,
        isCurrentClaimRequest,
        startClaimRequest,
    };
};
