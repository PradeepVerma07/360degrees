import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { api, API_URL } from './api';

const allowedExtensions = new Set(['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'zip']);
const maxAttachmentBytes = 10 * 1024 * 1024; // 10MB
const quickReactions = ['👍', '❤️', '🔥', '🎉', '🚀', '👏', '💯', '✨'];

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
  if (!allowedExtensions.has(extension)) throw new Error('File type not supported. Allowed: PDF, DOC, DOCX, JPG, PNG, GIF, WEBP, ZIP.');
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
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
};

const formatChatDateDivider = value => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Earlier';
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
};

const initialsFor = value => (value || 'User').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'U';

const roleColorClass = role => {
  const r = (role || '').toLowerCase();
  if (r.includes('super')) return 'role-super-admin';
  if (r.includes('admin')) return 'role-admin';
  if (r.includes('employee')) return 'role-employee';
  return 'role-client';
};

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
  const [showNewChannelModal, setShowNewChannelModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelDesc, setNewChannelDesc] = useState('');
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [mobileShowSidebar, setMobileShowSidebar] = useState(false);

  const messagesEndRef = useRef(null);
  const messagesScrollRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);
  const socketRef = useRef(null);

  // Load Channels and Members
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

  // Initial load
  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  // Channel switch
  useEffect(() => {
    if (activeChannelId) {
      loadMessages(activeChannelId);
      setMobileShowSidebar(false);
    }
  }, [activeChannelId, loadMessages]);

  // Auto scroll to bottom
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

  // Setup Socket.IO
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
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  const removeAttachment = () => {
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
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
      if (fileInputRef.current) fileInputRef.current.value = '';
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
    if (!window.confirm('Are you sure you want to delete this message?')) return;
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

  const filteredChannels = useMemo(() => {
    if (!channelSearch.trim()) return channels;
    const q = channelSearch.toLowerCase();
    return channels.filter(c => c.name.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q));
  }, [channels, channelSearch]);

  const filteredMessages = useMemo(() => {
    if (!messageSearch.trim()) return messages;
    const q = messageSearch.toLowerCase();
    return messages.filter(m => (m.body || '').toLowerCase().includes(q) || (m.senderName || '').toLowerCase().includes(q));
  }, [messages, messageSearch]);

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
    <div className="team-chat-wrapper">
      {/* Mobile Channel Toggle Bar */}
      <div className="team-chat-mobile-header">
        <button
          type="button"
          className="team-chat-toggle-btn"
          onClick={() => setMobileShowSidebar(v => !v)}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <span>#{activeChannel.name}</span>
        </button>
      </div>

      <div className="team-chat-container">
        {/* Left Sidebar: Channels & Members */}
        <aside className={`team-chat-sidebar ${mobileShowSidebar ? 'mobile-visible' : ''}`}>
          <div className="team-chat-sidebar-header">
            <div className="team-chat-sidebar-title">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <h2>Team Chat</h2>
            </div>
            {canManage && (
              <button
                type="button"
                className="chat-add-channel-btn"
                title="Create Channel"
                onClick={() => setShowNewChannelModal(true)}
              >
                +
              </button>
            )}
          </div>

          <div className="team-chat-search">
            <input
              type="text"
              placeholder="Search channels..."
              value={channelSearch}
              onChange={e => setChannelSearch(e.target.value)}
            />
          </div>

          <div className="team-chat-channel-list">
            <div className="chat-section-label">CHANNELS ({filteredChannels.length})</div>
            {loadingChannels ? (
              <div className="chat-loading-mini">Loading channels...</div>
            ) : filteredChannels.length === 0 ? (
              <div className="chat-empty-mini">No channels found</div>
            ) : (
              filteredChannels.map(channel => {
                const isActive = channel.id === activeChannelId;
                return (
                  <button
                    key={channel.id}
                    type="button"
                    className={`chat-channel-item ${isActive ? 'active' : ''}`}
                    onClick={() => setActiveChannelId(channel.id)}
                  >
                    <span className="channel-hash">#</span>
                    <span className="channel-name-text">{channel.name}</span>
                    {channel.messageCount > 0 && (
                      <span className="channel-count-badge">{channel.messageCount}</span>
                    )}
                  </button>
                );
              })
            )}

            {/* Team Directory Section */}
            <div className="chat-section-label" style={{ marginTop: '20px' }}>
              WORKSPACE MEMBERS ({members.length})
            </div>
            <div className="chat-members-list">
              {members.map(member => (
                <div key={member.id} className="chat-member-item">
                  <span className="chat-member-avatar">{initialsFor(member.name)}</span>
                  <div className="chat-member-info">
                    <span className="chat-member-name">{member.name}</span>
                    <span className={`chat-role-pill ${roleColorClass(member.role)}`}>
                      {member.role || 'Member'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Main Chat Panel */}
        <main className="team-chat-main">
          {/* Channel Header Bar */}
          <div className="team-chat-header">
            <div className="channel-header-info">
              <div className="channel-header-title">
                <span className="channel-hash-large">#</span>
                <h3>{activeChannel.name}</h3>
              </div>
              {activeChannel.description && (
                <p className="channel-header-desc">{activeChannel.description}</p>
              )}
            </div>

            <div className="channel-header-actions">
              <div className="chat-search-input-wrapper">
                <input
                  type="text"
                  placeholder="Search in conversation..."
                  value={messageSearch}
                  onChange={e => setMessageSearch(e.target.value)}
                />
              </div>

              {canManage && (
                <button
                  type="button"
                  className="chat-action-btn danger"
                  title="Clear conversation"
                  onClick={handleClearChannel}
                >
                  Clear Chat
                </button>
              )}
            </div>
          </div>

          {/* Messages Area */}
          <div className="team-chat-messages-area" ref={messagesScrollRef}>
            {error && <div className="chat-banner-error">{error}</div>}

            {loadingMessages ? (
              <div className="chat-state-box">
                <div className="chat-spinner" />
                <p>Loading messages...</p>
              </div>
            ) : filteredMessages.length === 0 ? (
              <div className="chat-state-box empty">
                <div className="chat-empty-icon">💬</div>
                <h4>Welcome to #{activeChannel.name}</h4>
                <p>
                  {activeChannel.description || 'This is the start of the conversation.'} Send the first message to get started!
                </p>
              </div>
            ) : (
              messageGroups.map((group, gIdx) => (
                <div key={gIdx} className="chat-message-group">
                  <div className="chat-date-divider">
                    <span>{group.date}</span>
                  </div>
                  {group.messages.map(msg => {
                    const isOwn = msg.senderId === currentUser.id;
                    return (
                      <div
                        key={msg.id}
                        className={`chat-message-row ${isOwn ? 'is-own' : ''}`}
                      >
                        <div className="chat-message-avatar">
                          {initialsFor(msg.senderName)}
                        </div>
                        <div className="chat-message-content">
                          <div className="chat-message-header">
                            <span className="chat-sender-name">{msg.senderName}</span>
                            <span className={`chat-role-pill ${roleColorClass(msg.senderRole)}`}>
                              {msg.senderRole}
                            </span>
                            <span className="chat-message-time">{formatChatTime(msg.createdAt)}</span>
                            {(isOwn || canManage) && (
                              <button
                                type="button"
                                className="chat-msg-delete-btn"
                                title="Delete message"
                                onClick={() => handleDeleteMessage(msg.id)}
                              >
                                ✕
                              </button>
                            )}
                          </div>

                          {msg.body && <div className="chat-message-body">{msg.body}</div>}

                          {msg.attachmentName && (
                            <div className="chat-message-attachment">
                              {msg.attachmentType?.startsWith('image/') && msg.attachmentData ? (
                                <div className="chat-attachment-image-wrap">
                                  <img
                                    src={`data:${msg.attachmentType};base64,${msg.attachmentData}`}
                                    alt={msg.attachmentName}
                                    className="chat-attachment-image"
                                  />
                                  <span className="chat-attachment-filename">{msg.attachmentName}</span>
                                </div>
                              ) : (
                                <div className="chat-attachment-file">
                                  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                    <polyline points="14 2 14 8 20 8" />
                                  </svg>
                                  <div className="chat-attachment-meta">
                                    <span className="chat-attachment-name">{msg.attachmentName}</span>
                                    {msg.attachmentSize && (
                                      <span className="chat-attachment-size">
                                        {(msg.attachmentSize / 1024).toFixed(1)} KB
                                      </span>
                                    )}
                                  </div>
                                  {msg.attachmentData && (
                                    <a
                                      href={`data:${msg.attachmentType || 'application/octet-stream'};base64,${msg.attachmentData}`}
                                      download={msg.attachmentName}
                                      className="chat-attachment-download"
                                    >
                                      Download
                                    </a>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Typing indicator */}
          {typingUsers.size > 0 && (
            <div className="chat-typing-indicator">
              <span>{[...typingUsers].join(', ')} {typingUsers.size === 1 ? 'is' : 'are'} typing...</span>
            </div>
          )}

          {/* Chat Input Bar */}
          {canSend ? (
            <form className="team-chat-input-container" onSubmit={handleSendMessage}>
              {/* Attachment Preview Chip */}
              {attachment && (
                <div className="chat-attachment-preview-chip">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                  <span>{attachment.name} ({(attachment.size / 1024).toFixed(1)} KB)</span>
                  <button type="button" onClick={removeAttachment} title="Remove attachment">✕</button>
                </div>
              )}

              <div className="chat-input-controls">
                <div className="chat-quick-reactions">
                  {quickReactions.slice(0, 5).map(emoji => (
                    <button
                      key={emoji}
                      type="button"
                      className="chat-reaction-mini-btn"
                      onClick={() => addEmojiToInput(emoji)}
                      title={`Insert ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>

                <div className="chat-input-row">
                  <label className="chat-file-upload-btn" title="Attach file or image">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                    <input
                      ref={fileInputRef}
                      type="file"
                      style={{ display: 'none' }}
                      onChange={handleFileSelect}
                    />
                  </label>

                  <textarea
                    rows={1}
                    className="chat-text-input"
                    placeholder={`Message #${activeChannel.name}... (Enter to send, Shift+Enter for new line)`}
                    value={inputText}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    disabled={sending}
                  />

                  <button
                    type="submit"
                    className="chat-send-btn"
                    disabled={sending || (!inputText.trim() && !attachment)}
                    title="Send message"
                  >
                    {sending ? (
                      <span className="chat-spinner-tiny" />
                    ) : (
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <div className="chat-readonly-banner">
              You have read-only access to this conversation.
            </div>
          )}
        </main>
      </div>

      {/* New Channel Modal */}
      {showNewChannelModal && (
        <div className="chat-modal-backdrop" onClick={() => setShowNewChannelModal(false)}>
          <div className="chat-modal-card" onClick={e => e.stopPropagation()}>
            <div className="chat-modal-header">
              <h3>Create Channel</h3>
              <button
                type="button"
                className="chat-modal-close"
                onClick={() => setShowNewChannelModal(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateChannel}>
              <div className="chat-form-group">
                <label>Channel Name</label>
                <div className="chat-input-prefix-wrap">
                  <span className="prefix">#</span>
                  <input
                    type="text"
                    required
                    placeholder="e.g. client-updates, design-ideas"
                    value={newChannelName}
                    onChange={e => setNewChannelName(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
                  />
                </div>
                <small>Use lowercase letters, numbers, and hyphens.</small>
              </div>

              <div className="chat-form-group">
                <label>Description (optional)</label>
                <textarea
                  rows={2}
                  placeholder="What is this channel about?"
                  value={newChannelDesc}
                  onChange={e => setNewChannelDesc(e.target.value)}
                />
              </div>

              <div className="chat-modal-actions">
                <button
                  type="button"
                  className="chat-btn-secondary"
                  onClick={() => setShowNewChannelModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="chat-btn-primary"
                  disabled={!newChannelName.trim()}
                >
                  Create Channel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
