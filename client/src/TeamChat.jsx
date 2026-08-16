import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { api, API_URL } from './api';

const allowedExtensions = new Set(['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'zip', 'mp3', 'wav', 'mp4']);
const maxAttachmentBytes = 10 * 1024 * 1024; // 10MB
const quickReactions = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉'];

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function attachmentPayload(file) {
  if (!file) return null;
  if (file.size > maxAttachmentBytes) throw new Error('File attachment must be 10 MB or smaller.');
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (!allowedExtensions.has(extension)) throw new Error('File type not supported. Allowed: PDF, DOC, DOCX, JPG, PNG, GIF, WEBP, ZIP, MP3, MP4.');
  const buffer = await file.arrayBuffer();
  return {
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
    data: bytesToBase64(new Uint8Array(buffer))
  };
}

const formatChatTime = value => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
};

const formatChatDateDivider = value => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Earlier';
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const diffDays = Math.round((today - date) / (1000 * 60 * 60 * 24));
  if (diffDays < 7 && diffDays > 0) return dayNames[date.getDay()];
  return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatListDate = value => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const diffDays = Math.round((today - date) / (1000 * 60 * 60 * 24));
  if (diffDays < 7 && diffDays > 0) return dayNames[date.getDay()];
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

const initialsFor = value => (value || 'User').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'U';

// Color palette for user names inside WhatsApp style chat bubbles
const nameColorPalette = [
  '#008069', '#128C7E', '#027eb5', '#6C5CE7', '#D63031',
  '#E17055', '#0984E3', '#00B894', '#2D3436', '#B71540'
];

function getNameColor(name) {
  if (!name) return '#008069';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return nameColorPalette[Math.abs(hash) % nameColorPalette.length];
}

export default function TeamChat({ data, reload }) {
  const currentUser = data?.user || {};
  const canSend = (data?.permissions || currentUser?.permissions || []).includes('chat.send');
  const canManage = (data?.permissions || currentUser?.permissions || []).includes('chat.manage');

  const [channels, setChannels] = useState([]);
  const [members, setMembers] = useState([]);
  const [activeChannelId, setActiveChannelId] = useState('general');
  const [messages, setMessages] = useState([]);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [inputText, setInputText] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [channelSearch, setChannelSearch] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all'); // 'all', 'unread', 'favourites', 'groups'
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showNewChannelModal, setShowNewChannelModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelDesc, setNewChannelDesc] = useState('');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [selectedVoiceMessage, setSelectedVoiceMessage] = useState(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  const messagesEndRef = useRef(null);
  const messagesScrollRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const socketRef = useRef(null);

  // Load Channels and Workspace Members
  const loadChannels = useCallback(async () => {
    try {
      setLoadingChannels(true);
      const res = await api.chatChannels();
      setChannels(res.channels || []);
      setMembers(res.members || []);
      if (res.channels?.length && !res.channels.some(c => c.id === activeChannelId)) {
        setActiveChannelId(res.channels[0].id);
      }
    } catch (err) {
      setError(err.message || 'Failed to load channels');
    } finally {
      setLoadingChannels(false);
    }
  }, [activeChannelId]);

  // Load Messages for current channel
  const loadMessages = useCallback(async (channelId) => {
    if (!channelId) return;
    try {
      setLoadingMessages(true);
      const res = await api.chatMessages(channelId);
      setMessages(res.messages || []);
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to load messages');
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  useEffect(() => {
    if (activeChannelId) {
      loadMessages(activeChannelId);
      setShowAttachMenu(false);
      setShowEmojiPicker(false);
      setShowMoreMenu(false);
    }
  }, [activeChannelId, loadMessages]);

  const scrollToBottom = useCallback((smooth = true) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
    }
  }, []);

  useEffect(() => {
    if (!loadingMessages && messages.length > 0) {
      scrollToBottom(false);
    }
  }, [messages.length, loadingMessages, scrollToBottom]);

  // Setup Real-Time Socket.IO
  useEffect(() => {
    const socket = io(API_URL || undefined);
    socketRef.current = socket;

    socket.on('chat:message', (newMsg) => {
      setChannels(prev => prev.map(c => {
        if (c.id === newMsg.channelId) {
          return {
            ...c,
            messageCount: (c.messageCount || 0) + 1,
            lastMessage: { at: newMsg.createdAt, body: newMsg.body, sender: newMsg.senderName }
          };
        }
        return c;
      }));

      if (newMsg.channelId === activeChannelId) {
        setMessages(prev => {
          if (prev.some(m => m.id === newMsg.id)) return prev;
          return [...prev, newMsg];
        });
        scrollToBottom(true);
      }
    });

    socket.on('chat:message_deleted', ({ id, channelId }) => {
      if (channelId === activeChannelId) {
        setMessages(prev => prev.filter(m => m.id !== id));
      }
    });

    socket.on('chat:channel_created', (channel) => {
      setChannels(prev => {
        if (prev.some(c => c.id === channel.id)) return prev;
        return [...prev, channel];
      });
    });

    socket.on('chat:cleared', ({ channelId }) => {
      if (channelId === activeChannelId) {
        setMessages([]);
      }
    });

    socket.on('chat:typing', ({ channelId, user }) => {
      if (channelId === activeChannelId && user !== currentUser.name) {
        setTypingUsers(prev => new Set([...prev, user]));
      }
    });

    socket.on('chat:stop_typing', ({ channelId, user }) => {
      if (channelId === activeChannelId) {
        setTypingUsers(prev => {
          const next = new Set(prev);
          next.delete(user);
          return next;
        });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [activeChannelId, currentUser.name, scrollToBottom]);

  const handleInputChange = (e) => {
    setInputText(e.target.value);
    if (socketRef.current) {
      socketRef.current.emit('chat:typing', { channelId: activeChannelId, user: currentUser.name });
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        if (socketRef.current) {
          socketRef.current.emit('chat:stop_typing', { channelId: activeChannelId, user: currentUser.name });
        }
      }, 1500);
    }
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const payload = await attachmentPayload(file);
      setAttachment(payload);
      setShowAttachMenu(false);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  const removeAttachment = () => {
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    if ((!inputText.trim() && !attachment) || sending) return;

    try {
      setSending(true);
      setError('');
      if (socketRef.current) {
        socketRef.current.emit('chat:stop_typing', { channelId: activeChannelId, user: currentUser.name });
      }

      await api.sendChatMessage(activeChannelId, {
        body: inputText.trim(),
        attachment: attachment || null
      });

      setInputText('');
      setAttachment(null);
      setShowEmojiPicker(false);
      setShowAttachMenu(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (imageInputRef.current) imageInputRef.current.value = '';
    } catch (err) {
      setError(err.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleDeleteMessage = async (id) => {
    if (!window.confirm('Delete this message for everyone?')) return;
    try {
      await api.deleteChatMessage(id);
    } catch (err) {
      setError(err.message || 'Failed to delete message');
    }
  };

  const handleClearChannel = async () => {
    if (!window.confirm(`Clear all messages in #${activeChannel?.name}? This cannot be undone.`)) return;
    try {
      await api.clearChatChannel(activeChannelId);
      setMessages([]);
      setShowMoreMenu(false);
    } catch (err) {
      setError(err.message || 'Failed to clear channel');
    }
  };

  const handleCreateChannel = async (e) => {
    e.preventDefault();
    if (!newChannelName.trim()) return;
    try {
      const res = await api.createChatChannel({
        name: newChannelName.trim().toLowerCase().replace(/\s+/g, '-'),
        description: newChannelDesc.trim()
      });
      setShowNewChannelModal(false);
      setNewChannelName('');
      setNewChannelDesc('');
      if (res.channel) {
        setActiveChannelId(res.channel.id);
      }
      loadChannels();
    } catch (err) {
      setError(err.message || 'Failed to create channel');
    }
  };

  const addEmojiToInput = (emoji) => {
    setInputText(prev => prev + emoji);
  };

  const activeChannel = useMemo(() => {
    return channels.find(c => c.id === activeChannelId) || { id: activeChannelId, name: activeChannelId, description: '' };
  }, [channels, activeChannelId]);

  // Participants subtitle summary
  const participantsSummary = useMemo(() => {
    if (!members.length) return 'You';
    const names = members.map(m => m.name.split(' ')[0]);
    const others = names.slice(0, 5).join(', ');
    return `${others}${names.length > 5 ? `, +${names.length - 5} more` : ''}, You`;
  }, [members]);

  const filteredChannels = useMemo(() => {
    let list = channels;
    if (activeFilter === 'unread') {
      list = list.filter(c => (c.messageCount || 0) > 0);
    }
    if (channelSearch.trim()) {
      const q = channelSearch.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q));
    }
    return list;
  }, [channels, activeFilter, channelSearch]);

  const filteredMessages = useMemo(() => {
    if (!messageSearch.trim()) return messages;
    const q = messageSearch.toLowerCase();
    return messages.filter(m => (m.body || '').toLowerCase().includes(q) || (m.senderName || '').toLowerCase().includes(q));
  }, [messages, messageSearch]);

  // Extract pinned links or info
  const pinnedInfo = useMemo(() => {
    // Find first message containing URLs or default to general pinned notice
    const urlMsg = messages.find(m => (m.body || '').includes('http'));
    if (urlMsg) {
      return `${urlMsg.senderName}: ${urlMsg.body}`;
    }
    return activeChannel.description || 'Welcome to team workspace coordination channel.';
  }, [messages, activeChannel]);

  // Group messages by date for dividers
  const messageGroups = useMemo(() => {
    const groups = [];
    let currentDate = null;
    let currentList = [];

    for (const msg of filteredMessages) {
      const dateKey = formatChatDateDivider(msg.createdAt);
      if (dateKey !== currentDate) {
        if (currentList.length > 0) {
          groups.push({ date: currentDate, messages: currentList });
        }
        currentDate = dateKey;
        currentList = [msg];
      } else {
        currentList.push(msg);
      }
    }
    if (currentList.length > 0) {
      groups.push({ date: currentDate, messages: currentList });
    }
    return groups;
  }, [filteredMessages]);

  return (
    <div className="wa-app-layout">
      {/* 1. LEFT UTILITY ICON RAIL */}
      <aside className="wa-utility-rail">
        <div className="wa-rail-top">
          {/* WhatsApp green icon */}
          <div className="wa-rail-icon-btn wa-brand-icon active" title="Chats">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
              <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2zm.01 1.67c4.54 0 8.24 3.7 8.24 8.24 0 2.2-.86 4.27-2.42 5.82a8.18 8.18 0 0 1-5.82 2.42c-1.47 0-2.91-.39-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.17 8.17 0 0 1-1.25-4.38c0-4.54 3.7-8.24 8.24-8.24z" />
            </svg>
            <span className="wa-rail-badge">19</span>
          </div>

          <div className="wa-rail-icon-btn" title="Calls">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            <span className="wa-rail-badge-mini">1</span>
          </div>

          <div className="wa-rail-icon-btn" title="Status">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" strokeDasharray="4 2" />
            </svg>
          </div>

          <div className="wa-rail-icon-btn" title="Channels">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>

          <div className="wa-rail-icon-btn wa-sparkle-btn" title="Meta AI">
            <span style={{ fontSize: '18px', background: 'linear-gradient(135deg, #a855f7, #6366f1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: 900 }}>✦</span>
          </div>
        </div>

        <div className="wa-rail-bottom">
          <div className="wa-rail-icon-btn" title="Settings">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </div>
          <div className="wa-rail-avatar" title={currentUser.name}>
            {initialsFor(currentUser.name)}
          </div>
        </div>
      </aside>

      {/* 2. CHATS LIST COLUMN */}
      <aside className="wa-chats-sidebar">
        {/* Header */}
        <div className="wa-chats-header">
          <h1 className="wa-chats-title">Chats</h1>
          <div className="wa-chats-header-actions">
            {canManage && (
              <button
                type="button"
                className="wa-icon-action-btn"
                title="New Channel / Chat"
                onClick={() => setShowNewChannelModal(true)}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            )}
            <button
              type="button"
              className="wa-icon-action-btn"
              title="Menu"
              onClick={() => setShowMoreMenu(v => !v)}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <circle cx="12" cy="6" r="1.7" />
                <circle cx="12" cy="12" r="1.7" />
                <circle cx="12" cy="18" r="1.7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="wa-search-container">
          <div className="wa-search-box">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#54656F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search or start a new chat"
              value={channelSearch}
              onChange={e => setChannelSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Filter Pills */}
        <div className="wa-filter-pills-row">
          <button
            type="button"
            className={`wa-filter-pill ${activeFilter === 'all' ? 'active' : ''}`}
            onClick={() => setActiveFilter('all')}
          >
            All
          </button>
          <button
            type="button"
            className={`wa-filter-pill ${activeFilter === 'unread' ? 'active' : ''}`}
            onClick={() => setActiveFilter('unread')}
          >
            Unread <span className="wa-filter-badge">{channels.reduce((acc, c) => acc + (c.messageCount || 0), 0)}</span>
          </button>
          <button
            type="button"
            className={`wa-filter-pill ${activeFilter === 'favourites' ? 'active' : ''}`}
            onClick={() => setActiveFilter('favourites')}
          >
            Favourites
          </button>
          <button
            type="button"
            className={`wa-filter-pill ${activeFilter === 'groups' ? 'active' : ''}`}
            onClick={() => setActiveFilter('groups')}
          >
            Groups ▾
          </button>
        </div>

        {/* Conversation List */}
        <div className="wa-chats-list">
          {loadingChannels ? (
            <div className="wa-list-loading">Loading conversations...</div>
          ) : filteredChannels.length === 0 ? (
            <div className="wa-list-empty">No chats found</div>
          ) : (
            filteredChannels.map((channel, idx) => {
              const isActive = channel.id === activeChannelId;
              const lastMsg = channel.lastMessage;
              return (
                <div
                  key={channel.id}
                  className={`wa-chat-item ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveChannelId(channel.id)}
                >
                  <div className="wa-chat-avatar" style={{ background: ['#DFD6C9', '#D1E4E8', '#E6D7E8', '#D6E4DE'][idx % 4] }}>
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="#54656F">
                      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                    </svg>
                  </div>
                  <div className="wa-chat-info">
                    <div className="wa-chat-top-line">
                      <span className="wa-chat-name">{channel.name.replace(/-/g, ' ')}</span>
                      <span className="wa-chat-time">
                        {lastMsg?.at ? formatListDate(lastMsg.at) : 'Friday'}
                      </span>
                    </div>
                    <div className="wa-chat-bottom-line">
                      <span className="wa-chat-snippet">
                        {lastMsg ? (
                          <>
                            <span className="wa-sender-tag">~{lastMsg.sender?.split(' ')[0]}: </span>
                            {lastMsg.body || 'Attachment'}
                          </>
                        ) : (
                          channel.description || 'Welcome to team coordination'
                        )}
                      </span>
                      <div className="wa-chat-badges">
                        {idx === 0 && <span className="wa-pin-icon" title="Pinned">📌</span>}
                        {channel.messageCount > 0 && (
                          <span className="wa-unread-count">{channel.messageCount}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* 3. MAIN CHAT CONVERSATION VIEW */}
      <main className="wa-conversation-view">
        {/* Top Header */}
        <div className="wa-convo-header">
          <div className="wa-convo-header-left">
            <div className="wa-convo-avatar">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="#54656F">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
            </div>
            <div className="wa-convo-details">
              <h2 className="wa-convo-title">{activeChannel.name.replace(/-/g, ' ')}</h2>
              <p className="wa-convo-subtitle">{participantsSummary}</p>
            </div>
          </div>

          <div className="wa-convo-header-actions">
            <button type="button" className="wa-header-icon-btn" title="Start video call">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </button>
            <button
              type="button"
              className="wa-header-icon-btn"
              title="Search in chat"
              onClick={() => {
                const term = window.prompt('Search messages:', messageSearch);
                if (term !== null) setMessageSearch(term);
              }}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="wa-header-icon-btn"
                title="More options"
                onClick={() => setShowMoreMenu(v => !v)}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                  <circle cx="12" cy="6" r="1.7" />
                  <circle cx="12" cy="12" r="1.7" />
                  <circle cx="12" cy="18" r="1.7" />
                </svg>
              </button>
              {showMoreMenu && (
                <div className="wa-popup-menu">
                  {canManage && (
                    <button type="button" onClick={handleClearChannel}>
                      Clear Messages
                    </button>
                  )}
                  <button type="button" onClick={() => { setShowMoreMenu(false); setShowNewChannelModal(true); }}>
                    New Channel
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Pinned Info Bar */}
        <div className="wa-pinned-bar">
          <span className="wa-pinned-icon">📌</span>
          <span className="wa-pinned-text">{pinnedInfo}</span>
        </div>

        {/* Messages Scroll Area with WhatsApp Doodle Background */}
        <div className="wa-messages-area" ref={messagesScrollRef}>
          {error && <div className="wa-error-banner">{error}</div>}

          {loadingMessages ? (
            <div className="wa-state-loading">
              <div className="wa-spinner" />
              <span>Loading messages...</span>
            </div>
          ) : filteredMessages.length === 0 ? (
            <div className="wa-welcome-box">
              <div className="wa-lock-badge">🔒 Messages are end-to-end secured.</div>
              <h3>#{activeChannel.name}</h3>
              <p>{activeChannel.description || 'Send a message to start team coordination.'}</p>
            </div>
          ) : (
            messageGroups.map((group, gIdx) => (
              <div key={gIdx} className="wa-date-group">
                <div className="wa-date-pill">
                  <span>{group.date}</span>
                </div>

                {group.messages.map(msg => {
                  const isOwn = msg.senderId === currentUser.id;
                  const nameColor = getNameColor(msg.senderName);

                  return (
                    <div key={msg.id} className={`wa-bubble-row ${isOwn ? 'outgoing' : 'incoming'}`}>
                      <div className="wa-bubble">
                        {/* Sender header (only for incoming messages in group chats) */}
                        {!isOwn && (
                          <div className="wa-bubble-sender-row">
                            <span className="wa-bubble-sender-name" style={{ color: nameColor }}>
                              ~ {msg.senderName}
                            </span>
                            <span className="wa-bubble-sender-phone">
                              {msg.senderRole || '+91 7600 918 041'}
                            </span>
                          </div>
                        )}

                        {/* Optional Forwarded Label */}
                        {msg.isForwarded && (
                          <div className="wa-forwarded-tag">
                            ↪ Forwarded
                          </div>
                        )}

                        {/* Attachment Card if present */}
                        {msg.attachmentName && (
                          <div className="wa-attachment-box">
                            {msg.attachmentType?.startsWith('image/') && msg.attachmentData ? (
                              <div className="wa-attachment-image-card">
                                <img
                                  src={`data:${msg.attachmentType};base64,${msg.attachmentData}`}
                                  alt={msg.attachmentName}
                                  className="wa-attachment-img"
                                />
                                <span className="wa-attachment-img-name">{msg.attachmentName}</span>
                              </div>
                            ) : (
                              <div className="wa-doc-attachment-card">
                                <div className="wa-doc-icon-block">
                                  <svg viewBox="0 0 24 24" width="28" height="28" fill="#54656F">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                    <polyline points="14 2 14 8 20 8" />
                                  </svg>
                                  <span className="wa-doc-type-badge">
                                    {msg.attachmentName.split('.').pop()?.toUpperCase() || 'FILE'}
                                  </span>
                                </div>
                                <div className="wa-doc-meta">
                                  <span className="wa-doc-title">{msg.attachmentName}</span>
                                  <span className="wa-doc-subtitle">
                                    {msg.attachmentName.split('.').pop()?.toUpperCase()} • {((msg.attachmentSize || 204800) / 1024).toFixed(0)} kB
                                  </span>
                                </div>
                                <div className="wa-doc-actions">
                                  {msg.attachmentData ? (
                                    <a
                                      href={`data:${msg.attachmentType || 'application/octet-stream'};base64,${msg.attachmentData}`}
                                      download={msg.attachmentName}
                                      className="wa-doc-btn"
                                    >
                                      Save as...
                                    </a>
                                  ) : (
                                    <button type="button" className="wa-doc-btn">Open</button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Simulated Voice note waveform if body includes [voice note] */}
                        {msg.body && msg.body.toLowerCase().includes('voice note') ? (
                          <div className="wa-voice-note-player">
                            <button
                              type="button"
                              className="wa-voice-play-btn"
                              onClick={() => setIsPlayingAudio(!isPlayingAudio)}
                            >
                              {isPlayingAudio ? '⏸' : '▶'}
                            </button>
                            <div className="wa-voice-waveform">
                              <span className="wa-wave-bar active" style={{ height: '60%' }} />
                              <span className="wa-wave-bar active" style={{ height: '90%' }} />
                              <span className="wa-wave-bar active" style={{ height: '40%' }} />
                              <span className="wa-wave-bar" style={{ height: '80%' }} />
                              <span className="wa-wave-bar" style={{ height: '50%' }} />
                              <span className="wa-wave-bar" style={{ height: '100%' }} />
                              <span className="wa-wave-bar" style={{ height: '70%' }} />
                              <span className="wa-wave-bar" style={{ height: '45%' }} />
                              <span className="wa-wave-bar" style={{ height: '65%' }} />
                            </div>
                            <span className="wa-voice-duration">0:12</span>
                            <div className="wa-voice-mic-badge">🎙</div>
                          </div>
                        ) : (
                          msg.body && (
                            <div className="wa-bubble-text">
                              {msg.body.split(' ').map((word, wIdx) => {
                                if (word.startsWith('@')) {
                                  return <strong key={wIdx} className="wa-mention-tag">{word} </strong>;
                                }
                                if (word.startsWith('http://') || word.startsWith('https://')) {
                                  return (
                                    <a key={wIdx} href={word} target="_blank" rel="noopener noreferrer" className="wa-bubble-link">
                                      {word}{' '}
                                    </a>
                                  );
                                }
                                return word + ' ';
                              })}
                            </div>
                          )
                        )}

                        {/* Time and checkmarks */}
                        <div className="wa-bubble-meta">
                          <span className="wa-bubble-time">{formatChatTime(msg.createdAt)}</span>
                          {isOwn && (
                            <span className="wa-double-check" title="Delivered and read">✓✓</span>
                          )}
                          {(isOwn || canManage) && (
                            <button
                              type="button"
                              className="wa-bubble-del-btn"
                              title="Delete"
                              onClick={() => handleDeleteMessage(msg.id)}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}

          {/* Typing indicator */}
          {typingUsers.size > 0 && (
            <div className="wa-typing-pill">
              <span>{[...typingUsers].join(', ')} {typingUsers.size === 1 ? 'is' : 'are'} typing...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Bottom Input Area */}
        <div className="wa-input-footer">
          {attachment && (
            <div className="wa-attach-preview-banner">
              <span>📎 {attachment.name} ({(attachment.size / 1024).toFixed(1)} KB)</span>
              <button type="button" onClick={removeAttachment}>✕</button>
            </div>
          )}

          {showEmojiPicker && (
            <div className="wa-emoji-quick-bar">
              {quickReactions.map(emoji => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => addEmojiToInput(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          <div className="wa-input-bar">
            {/* Plus / Attach Button */}
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="wa-footer-icon-btn"
                title="Attach"
                onClick={() => setShowAttachMenu(v => !v)}
              >
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#54656F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>

              {showAttachMenu && (
                <div className="wa-attach-popup">
                  <label className="wa-attach-option">
                    <span className="wa-attach-opt-icon" style={{ background: '#7f66ff' }}>📄</span>
                    <span>Document</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      style={{ display: 'none' }}
                      onChange={handleFileSelect}
                    />
                  </label>
                  <label className="wa-attach-option">
                    <span className="wa-attach-opt-icon" style={{ background: '#007bfc' }}>🖼️</span>
                    <span>Photos & Videos</span>
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/*,video/*"
                      style={{ display: 'none' }}
                      onChange={handleFileSelect}
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Emoji Button */}
            <button
              type="button"
              className="wa-footer-icon-btn"
              title="Emoji"
              onClick={() => setShowEmojiPicker(v => !v)}
            >
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#54656F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                <line x1="9" y1="9" x2="9.01" y2="9" />
                <line x1="15" y1="9" x2="15.01" y2="9" />
              </svg>
            </button>

            {/* Text Input */}
            <input
              type="text"
              className="wa-message-input"
              placeholder="Type a message"
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              disabled={sending || !canSend}
            />

            {/* Send or Mic Button */}
            {inputText.trim() || attachment ? (
              <button
                type="button"
                className="wa-send-circle-btn"
                onClick={handleSendMessage}
                disabled={sending}
                title="Send message"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                className="wa-footer-icon-btn"
                title="Voice note"
                onClick={() => addEmojiToInput('🎙️ [Voice note: 0:12]')}
              >
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#54656F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </main>

      {/* CREATE CHANNEL MODAL */}
      {showNewChannelModal && (
        <div className="modal-backdrop" onClick={() => setShowNewChannelModal(false)}>
          <div className="modal-dialog" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Create Team Channel</h3>
              <button type="button" className="modal-close-btn" onClick={() => setShowNewChannelModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateChannel}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Channel Name</label>
                  <input
                    type="text"
                    required
                    className="form-control"
                    placeholder="e.g. website-coordination, marketing-ops"
                    value={newChannelName}
                    onChange={e => setNewChannelName(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Description & Topic</label>
                  <textarea
                    className="form-textarea"
                    rows={2}
                    placeholder="What is this channel about?"
                    value={newChannelDesc}
                    onChange={e => setNewChannelDesc(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowNewChannelModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={!newChannelName.trim()}>Create Channel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
