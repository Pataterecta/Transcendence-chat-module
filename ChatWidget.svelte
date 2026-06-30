<script lang="ts">
  import { io, type Socket } from "socket.io-client";
  import { onDestroy, onMount } from "svelte";

  type Friend = {
    id: string;
    user: {
      id: string;
      username: string;
      avatar?: string | null;
    }
  };

  type Message = {
    id: string;
    roomId?: string;
    sessionId?: string;
    content: string;
    createdAt: string;
    userId: string | null;
    usernameSnap?: string;
  };

  type JwtPayload = {
    userId?: string;
  };

  let currentUserId = $state<string | null>(null);

  let isOpen = $state(false);
  let selectedFriend = $state<Friend | null>(null);

  let socket = $state<Socket | null>(null);
  let roomId = $state<string | null>(null);

  let friends = $state<Friend[]>([]);
  let friendsLoading = $state(false);

  let messages = $state<Message[]>([]);
  let input = $state("");
  let onlineUserIds = $state(new Set<string>());
  let messageListEl = $state<HTMLDivElement | null>(null);

  $effect(() => {
    messages;
    if (messageListEl)
      messageListEl.scrollTop = messageListEl.scrollHeight;
  });

  function getToken() {
    return localStorage.getItem("access_token");
  }

  function getAvatarUrl(avatar?: string | null) {
    return `/uploads/avatars/${avatar || "default-avatar.png"}`;
  }

  async function loadFriends() {
    const token = getToken();
    if (!token) {
      friendsLoading = false;
      return;
    }

    friendsLoading = true;
    try {
      const response = await fetch("/api/friends", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        throw new Error("Failed to load friends");
      }
      friends = await response.json();
    } catch (error) {
      console.error(error);
    } finally {
      friendsLoading = false;
    }
  }

  function decodeJwt(token: string): JwtPayload | null {
    try {
      const payload = token.split(".")[1];
      return JSON.parse(atob(payload));
    } catch {
      return null;
    }
  }

  function loadCurrentUserFromToken() {
    const token = getToken();
    if (!token) return;
    const payload = decodeJwt(token);
    currentUserId = payload?.userId ?? null;
  }

  function connectSocket() {
    if (socket?.connected) return;
    if (socket) return;

    const token = getToken();
    if (!token) return;

    loadCurrentUserFromToken();

    socket = io("/chat", {
      path: "/socket.io/",
      auth: { token },
    });

    socket.on("connect", () => {
      socket?.emit("getOnlineUsers");
    });

    socket.on("disconnect", () => {
      onlineUserIds = new Set();
    });

    socket.on("onlineUsers", (ids: string[]) => {
      onlineUserIds = new Set(ids);
    });

    socket.on("presence", ({ userId, online }: { userId: string; online: boolean }) => {
      onlineUserIds = new Set(onlineUserIds);
      if (online) onlineUserIds.add(userId);
      else onlineUserIds.delete(userId);
    });

    socket.on("roomJoined", (data: { roomId: string; messages: Message[] }) => {
      roomId = data.roomId;
      messages = data.messages;
    });

    socket.on("newMessage", (message: Message) => {
      messages = [...messages, message];
    });
  }

  onMount(() => {
    if (getToken()) connectSocket();
  });

  onDestroy(() => {
    socket?.disconnect();
    socket = null;
  });

  async function openChat(friend: Friend) {
    selectedFriend = friend;
    messages = [];
    input = "";
    roomId = null;

    connectSocket();

    const join = () => {
      socket?.emit("joinRoom", { friendId: friend.user.id });
    };

    if (socket?.connected) {
      join();
    } else {
      socket?.once("connect", join);
    }
  }

  function backToFriends() {
    selectedFriend = null;
    messages = [];
    input = "";
    roomId = null;
  }

  function formatTime(date: string) {
    return new Date(date).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  async function sendMessage(event?: SubmitEvent) {
    event?.preventDefault();

    const text = input.trim();
    if (!text || !selectedFriend || !roomId) return;

    socket?.emit("sendMessage", { roomId, content: text });
    input = "";
  }
</script>

<button
  class="mini-bar"
  onclick={() => {
    isOpen = true;
    loadFriends();
  }}
>
  contacts and chat
</button>

{#if isOpen}
  <section class="chat-window">
    {#if !selectedFriend}
      <header class="chat-header">
        <strong>Friend list</strong>
        <button onclick={() => (isOpen = false)}>—</button>
      </header>

      <div class="friend-list">
        {#if friendsLoading}
          <p>Loading friends...</p>
        {:else if friends.length === 0}
          <p>No friends yet.</p>
        {:else}
          {#each friends as friend}
            <button class="friend-card" onclick={() => openChat(friend)}>
              <div class="avatar-wrap">
                <img
                  src={getAvatarUrl(friend.user.avatar)}
                  alt={friend.user.username}
                />
                <span class="presence-dot {onlineUserIds.has(friend.user.id) ? 'online' : 'offline'}"></span>
              </div>
              <span>{friend.user.username}</span>
            </button>
          {/each}
        {/if}
      </div>
    {:else}
      <header class="chat-header">
        <button onclick={backToFriends}>←</button>
        <a href="/profile?id={selectedFriend.user.id}" class="chat-header-profile">
          <img
            src={getAvatarUrl(selectedFriend.user.avatar)}
            alt={selectedFriend.user.username}
            class="chat-header-avatar"
          />
          <strong>{selectedFriend.user.username}</strong>
        </a>
        <button onclick={() => (isOpen = false)}>—</button>
      </header>

      <div class="message-list" bind:this={messageListEl}>
        {#each messages as message}
          <div class:mine={message.userId === currentUserId} class="message-row">
            <div class="bubble">
              <p>{message.content}</p>
              <small>{formatTime(message.createdAt)}</small>
            </div>
          </div>
        {/each}
      </div>

      <form class="message-form" onsubmit={sendMessage}>
        <input bind:value={input} placeholder="type message..." />
        <button type="submit">↑</button>
      </form>
    {/if}
  </section>
{/if}

<style>
  .mini-bar {
    position: fixed;
    right: 24px;
    bottom: 24px;
    z-index: 50;
    padding: 8px 14px;
    border: 1px solid var(--color-border-strong);
    border-radius: 8px;
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
    &:hover { background: var(--color-surface-hover); }
  }

  .chat-window {
    background: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    box-shadow: 0 25px 50px -12px rgb(15 23 42 / 0.15);
    position: fixed;
    right: 24px;
    bottom: 70px;
    z-index: 50;
    width: 360px;
    height: 520px;
    border-radius: 16px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .chat-header {
    height: 48px;
    padding: 0 12px;
    border-bottom: 1px solid var(--color-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .chat-header-profile {
    display: flex;
    align-items: center;
    gap: 8px;
    text-decoration: none;
    color: inherit;
    border-radius: 8px;
    padding: 4px 6px;
    &:hover { background: var(--color-surface-hover); }
  }

  .chat-header-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    object-fit: cover;
    border: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .chat-header button {
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text-muted);
    border-radius: 8px;
    padding: 4px 8px;
    cursor: pointer;
    &:hover { background: var(--color-surface-hover); }
  }

  .friend-list {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
  }

  .friend-card {
    width: 100%;
    height: 88px;
    margin-bottom: 12px;
    padding: 12px;
    border-radius: 14px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    display: flex;
    align-items: center;
    gap: 16px;
    cursor: pointer;
    &:hover { background: var(--color-surface-hover); }
  }

  .avatar-wrap {
    position: relative;
    flex-shrink: 0;
    width: 52px;
    height: 52px;
  }

  .avatar-wrap img {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    object-fit: cover;
    border: 1px solid var(--color-border);
  }

  .presence-dot {
    position: absolute;
    bottom: 2px;
    right: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid var(--color-surface);
  }

  .presence-dot.online  { background: #22c55e; }
  .presence-dot.offline { background: #94a3b8; }

  .friend-card span {
    font-size: 24px;
    font-weight: 600;
    color: var(--color-text);
  }

  .message-list {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .message-row {
    display: flex;
    justify-content: flex-start;
  }

  .message-row.mine {
    justify-content: flex-end;
  }

  .bubble {
    max-width: 70%;
    padding: 10px 12px;
    border: 1px solid var(--color-border);
    border-radius: 14px;
    background: var(--color-surface);
    color: var(--color-text);
  }

  .mine .bubble {
    background: var(--color-primary);
    border-color: var(--color-border-strong);
    color: var(--color-text);
  }

  .bubble p {
    margin: 0 0 4px;
    word-break: break-word;
  }

  .bubble small {
    display: block;
    font-size: 11px;
    color: currentColor;
    opacity: 0.7;
    text-align: right;
  }

  .message-form {
    height: 52px;
    padding: 8px;
    display: flex;
    gap: 8px;
    border-top: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .message-form input {
    flex: 1;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0 12px;
    background: var(--color-surface);
    color: var(--color-text);
  }

  .message-form button {
    width: 42px;
    border: 1px solid var(--color-border-strong);
    border-radius: 10px;
    background: var(--color-primary);
    color: var(--color-text);
    cursor: pointer;
    &:hover { background: var(--color-primary-hover); }
  }
</style>
