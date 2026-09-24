"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  createTikTokAppProfile,
  updateTikTokAppProfile,
  deleteTikTokAppProfile,
  type TikTokAppProfileListItem,
} from "@/server/tiktok-app-profiles";
import type { TikTokAppProfileFormState } from "@/server/tiktok-app-profiles.schemas";

const initialState: TikTokAppProfileFormState = {};

interface Props {
  profiles: TikTokAppProfileListItem[];
  redirectUri: string;
}

export function TikTokAppProfiles({ profiles, redirectUri }: Props) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='space-y-1'>
          <h2 className='text-xl font-semibold tracking-tight'>
            TikTok App Profiles
          </h2>
          <p className='text-sm text-muted-foreground'>
            Register your own TikTok for Business app(s). Credentials are stored
            encrypted and never shared.
          </p>
        </div>
        {!adding && (
          <Button size='sm' onClick={() => setAdding(true)}>
            Add profile
          </Button>
        )}
      </div>

      <RedirectUriNotice redirectUri={redirectUri} />

      {adding && (
        <ProfileForm
          mode='create'
          redirectUri={redirectUri}
          onDone={() => setAdding(false)}
          onCancel={() => setAdding(false)}
        />
      )}

      {profiles.length === 0 && !adding ? (
        <Card className='p-6 text-sm text-muted-foreground'>
          No TikTok App Profiles yet.
        </Card>
      ) : (
        <div className='space-y-3'>
          {profiles.map((p) =>
            editingId === p.id ? (
              <ProfileForm
                key={p.id}
                mode='edit'
                profile={p}
                redirectUri={redirectUri}
                onDone={() => setEditingId(null)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <ProfileRow
                key={p.id}
                profile={p}
                onEdit={() => setEditingId(p.id)}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function RedirectUriNotice({ redirectUri }: { redirectUri: string }) {
  const [copied, setCopied] = useState(false);
  if (!redirectUri) return null;

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable; ignore.
    }
  };

  return (
    <Card className='space-y-2 border-cyan-500/20 bg-info/5 p-4'>
      <p className='text-sm font-medium'>OAuth redirect URI</p>
      <p className='text-xs text-muted-foreground'>
        Add this URL to your app&apos;s Redirect URLs in the TikTok for Business
        developer portal.
      </p>
      <div className='flex items-center gap-2'>
        <code className='flex-1 break-all rounded-md border border-border/60 bg-background px-3 py-2 font-mono text-xs'>
          {redirectUri}
        </code>
        <Button size='sm' variant='outline' onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </Card>
  );
}

function ProfileRow({
  profile,
  onEdit,
}: {
  profile: TikTokAppProfileListItem;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const handleDelete = (): void => {
    setError(null);
    startTransition(async () => {
      const result = await deleteTikTokAppProfile({ id: profile.id });
      if (result.ok) {
        setConfirming(false);
        router.refresh();
      } else {
        setError(result.error);
        setConfirming(false);
      }
    });
  };

  return (
    <Card className='space-y-3 p-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0 space-y-1'>
          <div className='flex items-center gap-2'>
            <span className='font-medium'>{profile.name}</span>
            <Badge variant='muted'>{profile.apiVersion}</Badge>
            {profile.connectionCount > 0 && (
              <Badge variant='info'>
                {profile.connectionCount} connection
                {profile.connectionCount === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
          <div className='font-mono text-xs text-muted-foreground'>
            App ID: {profile.appId} · Secret: {profile.appSecretLast4}
          </div>
        </div>
        <div className='flex items-center gap-2'>
          <Button
            size='sm'
            variant='outline'
            onClick={onEdit}
            disabled={pending}>
            Edit
          </Button>
          {confirming ? (
            <>
              <Button
                size='sm'
                variant='destructive'
                onClick={handleDelete}
                disabled={pending}>
                {pending ? "Deleting…" : "Confirm delete"}
              </Button>
              <Button
                size='sm'
                variant='ghost'
                onClick={() => setConfirming(false)}
                disabled={pending}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size='sm'
              variant='outline'
              onClick={() => setConfirming(true)}
              disabled={pending}>
              Delete
            </Button>
          )}
        </div>
      </div>
      {error && <p className='text-xs text-destructive'>{error}</p>}
    </Card>
  );
}

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <Button type='submit' size='sm' disabled={pending}>
      {pending
        ? "Saving…"
        : mode === "create"
          ? "Create profile"
          : "Save changes"}
    </Button>
  );
}

function ProfileForm({
  mode,
  profile,
  redirectUri,
  onDone,
  onCancel,
}: {
  mode: "create" | "edit";
  profile?: TikTokAppProfileListItem;
  redirectUri: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const action =
    mode === "create" ? createTikTokAppProfile : updateTikTokAppProfile;
  const [state, formAction] = useFormState(
    async (prev: TikTokAppProfileFormState, formData: FormData) => {
      const result = await action(prev, formData);
      if (result.ok) {
        router.refresh();
        onDone();
      }
      return result;
    },
    initialState,
  );

  return (
    <Card className='space-y-4 p-4'>
      <p className='text-sm font-medium'>
        {mode === "create"
          ? "New TikTok App Profile"
          : `Edit ${profile?.name}`}
      </p>
      <form action={formAction} className='space-y-4'>
        {mode === "edit" && profile && (
          <input type='hidden' name='id' value={profile.id} />
        )}

        <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
          <div className='space-y-1.5'>
            <Label htmlFor='tp-name'>Name</Label>
            <Input
              id='tp-name'
              name='name'
              defaultValue={profile?.name ?? ""}
              placeholder='Acme Production App'
              required
              maxLength={120}
            />
            {state.errors?.name && (
              <p className='text-xs text-destructive'>{state.errors.name[0]}</p>
            )}
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='tp-apiVersion'>API version</Label>
            <Input
              id='tp-apiVersion'
              name='apiVersion'
              defaultValue={profile?.apiVersion ?? "v1.3"}
              placeholder='v1.3'
              required
            />
            {state.errors?.apiVersion && (
              <p className='text-xs text-destructive'>
                {state.errors.apiVersion[0]}
              </p>
            )}
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='tp-appId'>App ID</Label>
            <Input
              id='tp-appId'
              name='appId'
              defaultValue={profile?.appId ?? ""}
              placeholder='7000000000000000000'
              inputMode='numeric'
              required
            />
            {state.errors?.appId && (
              <p className='text-xs text-destructive'>
                {state.errors.appId[0]}
              </p>
            )}
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='tp-appSecret'>App Secret</Label>
            <Input
              id='tp-appSecret'
              name='appSecret'
              type='password'
              autoComplete='off'
              placeholder={
                mode === "edit"
                  ? "Leave blank to keep current secret"
                  : "Your TikTok app secret"
              }
              required={mode === "create"}
            />
            {state.errors?.appSecret && (
              <p className='text-xs text-destructive'>
                {state.errors.appSecret[0]}
              </p>
            )}
            {mode === "edit" && (
              <p className='text-[11px] text-muted-foreground'>
                Secrets are write-only. Enter a new value only to rotate it.
              </p>
            )}
          </div>
        </div>

        {redirectUri && mode === "create" && (
          <p className='text-xs text-muted-foreground'>
            After creating, whitelist the OAuth redirect URI shown above in your
            TikTok app settings.
          </p>
        )}

        {state.errors?._form && (
          <p className='text-xs text-destructive'>{state.errors._form[0]}</p>
        )}

        <div className='flex items-center gap-2'>
          <SubmitButton mode={mode} />
          <Button type='button' size='sm' variant='ghost' onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
