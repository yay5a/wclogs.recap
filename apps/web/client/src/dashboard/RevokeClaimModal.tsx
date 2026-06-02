import type { SyntheticEvent } from 'react';
import type { CharacterClaim, Directory } from '../api.js';
import { revokeReasons } from './constants.js';
import { claimCharacter, userLabelForClaim } from './display.js';

type RevokeClaimModalProps = {
  claim: CharacterClaim;
  directory: Directory | null;
  onCancel: () => void;
  onReasonChange: (reason: string) => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
  reason: string;
};

export const RevokeClaimModal = ({
  claim,
  directory,
  onCancel,
  onReasonChange,
  onSubmit,
  reason,
}: RevokeClaimModalProps) => {
  const selectedReasonLabel = revokeReasons.find(([value]) => value === reason)?.[1] ?? reason;

  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={onSubmit}>
        <h3>Revoke claim?</h3>
        <p>
          This will revoke {userLabelForClaim(claim, directory)}'s claim for {claimCharacter(claim)}
          .
        </p>
        <p>Reason: {selectedReasonLabel}</p>
        <p>
          The character will be removed from the approved claims list. Historical claim/activity
          records will not be deleted.
        </p>
        <label>
          Reason
          <select value={reason} onChange={(event) => onReasonChange(event.target.value)}>
            {revokeReasons.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="danger">
            Revoke
          </button>
        </div>
      </form>
    </div>
  );
};
