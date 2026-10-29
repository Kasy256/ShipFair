import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { deleteAccount } from '../../lib/profile-api.ts';
import { useUiStore } from '../../state/ui-store.ts';
import { accessToken, signOut } from '../../state/use-auth-sync.ts';
import { authToastText, profileErrorText } from '../errors.ts';

interface DeleteAccountProps {
  handle: string;
}

/**
 * Account deletion with a confirmation step: the user types their handle. The Worker deletes the
 * auth user (profile, booths, votes and guestbook entries cascade) and queues booth media for
 * deletion after 30 days.
 */
export function DeleteAccount({ handle }: DeleteAccountProps) {
  const navigate = useNavigate();
  const showToast = useUiStore((s) => s.showToast);
  const [isConfirming, setIsConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const matches = typed.trim().replace(/^@/, '') === handle;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!matches) return;
    setIsDeleting(true);
    setFailure(null);
    try {
      const token = await accessToken();
      if (!token) throw new Error('no session');
      await deleteAccount(token, handle);
      await signOut();
      showToast(authToastText('account_deleted'));
      navigate('/', { replace: true });
    } catch (error) {
      console.error('Account deletion failed', error);
      setFailure(profileErrorText(error));
      setIsDeleting(false);
    }
  };

  if (!isConfirming) {
    return (
      <button
        type="button"
        onClick={() => setIsConfirming(true)}
        className="rounded-xl bg-red-900/70 px-4 py-2.5 font-semibold text-red-50 hover:bg-red-900"
      >
        Delete my account…
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-xl bg-red-950/50 p-4" aria-labelledby="delete-title">
      <h3 id="delete-title" className="font-bold text-lg">
        Delete your account?
      </h3>
      <p className="mt-1 text-sm">
        This removes your profile, booths, upvotes and guestbook entries right away. Booth images
        are deleted after 30 days. It can't be undone.
      </p>
      <label htmlFor="delete-handle" className="mt-3 block font-semibold text-sm">
        Type your handle <span className="font-mono">@{handle}</span> to confirm
      </label>
      <input
        id="delete-handle"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        className="mt-1 w-full rounded-xl bg-ink px-3 py-2 ring-1 ring-white/15"
      />
      {failure && (
        <p role="alert" className="mt-2 text-red-200 text-sm">
          {failure}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={!matches || isDeleting}
          className="rounded-xl bg-red-600 px-4 py-2.5 font-bold text-white disabled:opacity-50"
        >
          {isDeleting ? 'Deleting…' : 'Delete my account'}
        </button>
        <button
          type="button"
          onClick={() => {
            setIsConfirming(false);
            setTyped('');
          }}
          className="rounded-xl bg-ink-3 px-4 py-2.5 font-semibold hover:bg-ink"
        >
          Keep my account
        </button>
      </div>
    </form>
  );
}
