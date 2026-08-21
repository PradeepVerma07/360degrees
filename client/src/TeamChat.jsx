import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { getSocket } from './socket';
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

const getDmChannelId = (u1, u2) => 'dm-' + [String(u1), String(u2)].sort().join('-').replace(/[^a-z0-9_-]/g, '-');

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

export default function TeamChat({ data, reload, onCloseMobile }) {
  const currentUser = data?.user || {};
  const canSend = (data?.permissions || currentUser?.permissions || []).includes('chat.send');
  const canManage = (data?.permissions || currentUser?.permissions || []).includes('chat.manage');

  const [channels, setChannels] = useState([]);
  const [members, setMembers] = useState([]);
  const [activeChannelId, setActiveChannelId] = useState('general');
  const [activeDirectMember, setActiveDirectMember] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [inputText, setInputText] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [channelSearch, setChannelSearch] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [showChannelInfo, setShowChannelInfo] = useState(false);
  const [channelMemberFilter, setChannelMemberFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('all'); // 'all', 'groups', 'direct', 'unread'
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showNewChannelModal, setShowNewChannelModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelDesc, setNewChannelDesc] = useState('');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  // Real-Time WebRTC Calling States (Voice & Video)
  const [callActive, setCallActive] = useState(false);
  const [callType, setCallType] = useState('voice'); // 'voice' | 'video'
  const [callStatus, setCallStatus] = useState(null); // 'calling' | 'connected' | 'ended'
  const [callTimer, setCallTimer] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null);

  // Mobile navigation state (false = showing conversation list, true = showing chat messages)
  const [mobileChatOpen, setMobileChatOpen] = useState(false);

  const messagesEndRef = useRef(null);
  const messagesScrollRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const socketRef = useRef(null);

  // WebRTC Media Refs
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);

  // Load Channels and Workspace Members
  const loadChannels = useCallback(async () => {
    try {
      setLoadingChannels(true);
      const res = await api.chatChannels();
      setChannels(res.channels || []);
      setMembers((res.members || []).filter(m => m.id !== currentUser.id));
      if (res.channels?.length && !res.channels.some(c => c.id === activeChannelId) && !activeDirectMember) {
        setActiveChannelId(res.channels[0].id);
      }
    } catch (err) {
      setError(err.message || 'Failed to load channels');
    } finally {
      setLoadingChannels(false);
    }
  }, [activeChannelId, activeDirectMember, currentUser.id]);

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
      setShowSearchBar(false);
      setMessageSearch('');
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

  // Call Duration Timer
  useEffect(() => {
    let interval = null;
    if (callActive && callStatus === 'connected') {
      interval = setInterval(() => {
        setCallTimer(prev => prev + 1);
      }, 1000);
    } else {
      if (interval) clearInterval(interval);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [callActive, callStatus]);

  const formatCallTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Initialize WebRTC Peer Connection
  const initPeerConnection = useCallback((localStream) => {
    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch (err) {
        console.warn('Error closing existing peer connection:', err);
      }
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnectionRef.current = pc;

    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    pc.ontrack = (event) => {
      console.log('[CI360 WebRTC] Inbound stream track received:', event.track.kind);
      if (event.streams && event.streams[0]) {
        remoteStreamRef.current = event.streams[0];
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = event.streams[0];
          remoteAudioRef.current.play().catch(() => {});
        }
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('call:signal', {
          channelId: activeChannelId,
          fromId: currentUser.id,
          signal: { type: 'candidate', candidate: event.candidate }
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[CI360 WebRTC] Connection state:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        setCallStatus('connected');
      }
    };

    return pc;
  }, [activeChannelId, currentUser.id]);

  // Start Real-Time Voice or Video Call
  const startCall = async (type = 'voice') => {
    setCallType(type);
    setCallActive(true);
    setCallStatus('calling');
    setCallTimer(0);
    setIsMuted(false);
    setIsVideoOff(false);
    setIsScreenSharing(false);

    let stream = null;
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: type === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false
        }).catch(err => {
          console.warn('[CI360] getUserMedia error:', err);
          return null;
        });

        if (stream) {
          localStreamRef.current = stream;
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
          }
        }
      }
    } catch (e) {
      console.warn('Audio/Video capture error:', e);
    }

    const pc = initPeerConnection(stream);
    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: type === 'video'
      });
      await pc.setLocalDescription(offer);

      if (socketRef.current) {
        socketRef.current.emit('call:initiate', {
          from: currentUser.name || 'Workspace User',
          fromId: currentUser.id,
          callType: type,
          channelId: activeChannelId,
          channelTitle: activeDirectMember ? activeDirectMember.name : activeChannelId,
          offer: offer
        });
      }
    } catch (err) {
      console.warn('[CI360 WebRTC] offer creation notice:', err);
    }

    // Safety timer to mark connected if answer is slightly delayed
    setTimeout(() => {
      setCallStatus(s => s === 'calling' ? 'connected' : s);
    }, 2500);
  };

  // Accept Incoming Call
  const acceptIncomingCall = async (callData) => {
    setIncomingCall(null);
    const type = callData.callType || 'voice';
    setCallType(type);
    setCallActive(true);
    setCallStatus('connected');
    setCallTimer(0);
    setIsMuted(false);
    setIsVideoOff(false);
    setIsScreenSharing(false);

    let stream = null;
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: type === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false
        }).catch(err => {
          console.warn('[CI360] getUserMedia accept error:', err);
          return null;
        });

        if (stream) {
          localStreamRef.current = stream;
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
          }
        }
      }
    } catch (e) {
      console.warn('Media capture error on call accept:', e);
    }

    const pc = initPeerConnection(stream);
    if (callData.offer) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(callData.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        if (socketRef.current) {
          socketRef.current.emit('call:accept', {
            channelId: callData.channelId,
            fromId: currentUser.id,
            answer: answer
          });
        }
      } catch (err) {
        console.warn('[CI360 WebRTC] accept answer error:', err);
      }
    }
  };

  // End Call & Full Cleanup
  const endCall = () => {
    setCallStatus('ended');
    if (socketRef.current) {
      socketRef.current.emit('call:end', { channelId: activeChannelId, fromId: currentUser.id });
    }
    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch {}
      peerConnectionRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current = null;
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;

    setTimeout(() => {
      setCallActive(false);
      setCallStatus(null);
      setCallTimer(0);
      setIncomingCall(null);
    }, 1000);
  };

  // Toggle Mute Audio
  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
    }
    setIsMuted(prev => !prev);
  };

  // Toggle Video Camera
  const toggleVideo = async () => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      if (videoTracks.length > 0) {
        videoTracks.forEach(track => {
          track.enabled = !track.enabled;
        });
        setIsVideoOff(prev => !prev);
      } else {
        // Upgrade voice call to video call stream
        try {
          if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            const vStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localStreamRef.current = vStream;
            if (localVideoRef.current) {
              localVideoRef.current.srcObject = vStream;
            }
            if (peerConnectionRef.current) {
              vStream.getVideoTracks().forEach(track => {
                peerConnectionRef.current.addTrack(track, vStream);
              });
            }
            setCallType('video');
            setIsVideoOff(false);
          }
        } catch (e) {
          console.warn('Cannot enable video track:', e);
        }
      }
    } else {
      setIsVideoOff(prev => !prev);
    }
  };

  // Toggle Screen Share
  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      setIsScreenSharing(false);
      if (callType === 'video' && localStreamRef.current && localVideoRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
    } else {
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
          const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
          setIsScreenSharing(true);
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = screenStream;
          }
          if (peerConnectionRef.current) {
            const screenTrack = screenStream.getVideoTracks()[0];
            const sender = peerConnectionRef.current.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
              sender.replaceTrack(screenTrack);
            }
          }
          screenStream.getVideoTracks()[0].onended = () => {
            setIsScreenSharing(false);
            if (localStreamRef.current && localVideoRef.current) {
              localVideoRef.current.srcObject = localStreamRef.current;
            }
          };
        }
      } catch (err) {
        console.warn('Screen share cancelled or not allowed:', err);
      }
    }
  };

  // Setup Real-Time Socket.IO
  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    const onMessage = (newMsg) => {
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
    };

    const onMessageDeleted = ({ id, channelId }) => {
      if (channelId === activeChannelId) {
        setMessages(prev => prev.filter(m => m.id !== id));
      }
    };

    const onChannelCreated = (channel) => {
      setChannels(prev => {
        if (prev.some(c => c.id === channel.id)) return prev;
        return [...prev, channel];
      });
    };

    const onCleared = ({ channelId }) => {
      if (channelId === activeChannelId) {
        setMessages([]);
      }
    };

    const onTyping = ({ channelId, user }) => {
      if (channelId === activeChannelId && user !== currentUser.name) {
        setTypingUsers(prev => new Set([...prev, user]));
      }
    };

    const onStopTyping = ({ channelId, user }) => {
      if (channelId === activeChannelId) {
        setTypingUsers(prev => {
          const next = new Set(prev);
          next.delete(user);
          return next;
        });
      }
    };

    const onIncomingCall = (data) => {
      if (data.fromId !== currentUser.id) {
        setIncomingCall(data);
      }
    };

    const onCallAccepted = async (data) => {
      if (data.fromId !== currentUser.id && peerConnectionRef.current && data.answer) {
        try {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
          setCallStatus('connected');
        } catch (e) {
          console.warn('[CI360 WebRTC] setRemoteDescription error on accept:', e);
        }
      }
    };

    const onCallSignal = async (data) => {
      if (data.fromId !== currentUser.id && peerConnectionRef.current && data.signal) {
        try {
          if (data.signal.type === 'candidate' && data.signal.candidate) {
            await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.signal.candidate));
          }
        } catch (e) {
          console.warn('[CI360 WebRTC] addIceCandidate error:', e);
        }
      }
    };

    const onCallEnded = () => {
      setIncomingCall(null);
      if (callActive) {
        endCall();
      }
    };

    socket.on('chat:message', onMessage);
    socket.on('chat:message_deleted', onMessageDeleted);
    socket.on('chat:channel_created', onChannelCreated);
    socket.on('chat:cleared', onCleared);
    socket.on('chat:typing', onTyping);
    socket.on('chat:stop_typing', onStopTyping);
    socket.on('call:incoming', onIncomingCall);
    socket.on('call:accepted', onCallAccepted);
    socket.on('call:signal', onCallSignal);
    socket.on('call:ended', onCallEnded);

    return () => {
      socket.off('chat:message', onMessage);
      socket.off('chat:message_deleted', onMessageDeleted);
      socket.off('chat:channel_created', onChannelCreated);
      socket.off('chat:cleared', onCleared);
      socket.off('chat:typing', onTyping);
      socket.off('chat:stop_typing', onStopTyping);
      socket.off('call:incoming', onIncomingCall);
      socket.off('call:accepted', onCallAccepted);
      socket.off('call:signal', onCallSignal);
      socket.off('call:ended', onCallEnded);
    };
  }, [activeChannelId, currentUser.name, currentUser.id, callActive, scrollToBottom]);

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
    if (!window.confirm(`Clear all messages in this conversation? This cannot be undone.`)) return;
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
        setActiveDirectMember(null);
        setActiveChannelId(res.channel.id);
        setMobileChatOpen(true);
      }
      loadChannels();
    } catch (err) {
      setError(err.message || 'Failed to create channel');
    }
  };

  // Open Direct Message with a team member
  const handleOpenDirectChat = (member) => {
    const dmId = getDmChannelId(currentUser.id, member.id);
    setActiveDirectMember(member);
    setActiveChannelId(dmId);
    setMobileChatOpen(true);
  };

  // Open Group Channel
  const handleOpenChannel = (channel) => {
    setActiveDirectMember(null);
    setActiveChannelId(channel.id);
    setMobileChatOpen(true);
  };

  const addEmojiToInput = (emoji) => {
    setInputText(prev => prev + emoji);
  };

  // Current active entity info
  const currentChatInfo = useMemo(() => {
    if (activeDirectMember) {
      return {
        title: activeDirectMember.name,
        subtitle: `Online • ${activeDirectMember.role || 'Team Member'}`,
        isDirect: true,
        avatar: initialsFor(activeDirectMember.name)
      };
    }
    const ch = channels.find(c => c.id === activeChannelId) || { name: activeChannelId, description: '' };
    const memberNames = members.map(m => m.name.split(' ')[0]);
    const summary = memberNames.slice(0, 4).join(', ') + (memberNames.length > 4 ? ` +${memberNames.length - 4}` : '') + ', You';
    return {
      title: ch.name.replace(/-/g, ' '),
      subtitle: summary,
      isDirect: false,
      description: ch.description,
      avatar: null
    };
  }, [activeDirectMember, activeChannelId, channels, members]);

  // Filter channels and members
  const filteredChannels = useMemo(() => {
    let list = channels.filter(c => !c.id.startsWith('dm-'));
    if (activeFilter === 'direct') return [];
    if (activeFilter === 'unread') {
      list = list.filter(c => (c.messageCount || 0) > 0);
    }
    if (channelSearch.trim()) {
      const q = channelSearch.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q));
    }
    return list;
  }, [channels, activeFilter, channelSearch]);

  const filteredMembers = useMemo(() => {
    if (activeFilter === 'groups') return [];
    let list = members;
    if (channelSearch.trim()) {
      const q = channelSearch.toLowerCase();
      list = list.filter(m => m.name.toLowerCase().includes(q) || (m.role || '').toLowerCase().includes(q));
    }
    return list;
  }, [members, activeFilter, channelSearch]);

  const filteredMessages = useMemo(() => {
    if (!messageSearch.trim()) return messages;
    const q = messageSearch.toLowerCase();
    return messages.filter(m => (m.body || '').toLowerCase().includes(q) || (m.senderName || '').toLowerCase().includes(q));
  }, [messages, messageSearch]);

  // Pinned bar content
  const pinnedInfo = useMemo(() => {
    const urlMsg = messages.find(m => (m.body || '').includes('http'));
    if (urlMsg) return `${urlMsg.senderName}: ${urlMsg.body}`;
    if (activeDirectMember) return `Direct encrypted workspace conversation with ${activeDirectMember.name}`;
    return currentChatInfo.description || 'Welcome to team workspace coordination channel.';
  }, [messages, activeDirectMember, currentChatInfo]);

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
    <div className={`wa-app-layout ${mobileChatOpen ? 'mobile-chat-active' : 'mobile-list-active'}`}>
      {/* 1. CHATS & TEAM MEMBERS LIST COLUMN (STARTING SCREEN ON MOBILE) */}
      <aside className="wa-chats-sidebar">
        {/* Header */}
        <div className="wa-chats-header">
          <h1 className="wa-chats-title">Chats</h1>
          <div className="wa-chats-header-actions">
            {canManage && (
              <button
                type="button"
                className="wa-icon-action-btn"
                title="New Channel / Group"
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
            {onCloseMobile && (
              <button
                type="button"
                className="wa-mobile-exit-btn mobile-only"
                title="Exit Fullscreen Chat"
                onClick={onCloseMobile}
              >
                ✕
              </button>
            )}
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
            className={`wa-filter-pill ${activeFilter === 'groups' ? 'active' : ''}`}
            onClick={() => setActiveFilter('groups')}
          >
            Groups ({channels.filter(c => !c.id.startsWith('dm-')).length})
          </button>
          <button
            type="button"
            className={`wa-filter-pill ${activeFilter === 'direct' ? 'active' : ''}`}
            onClick={() => setActiveFilter('direct')}
          >
            Direct ({members.length})
          </button>
          <button
            type="button"
            className={`wa-filter-pill ${activeFilter === 'unread' ? 'active' : ''}`}
            onClick={() => setActiveFilter('unread')}
          >
            Unread
          </button>
        </div>

        {/* Conversation List (Groups + Direct Team Members) */}
        <div className="wa-chats-list">
          {loadingChannels ? (
            <div className="wa-list-loading">Loading conversations...</div>
          ) : (
            <>
              {/* GROUPS / CHANNELS */}
              {filteredChannels.length > 0 && (
                <>
                  {activeFilter === 'all' && (
                    <div className="wa-list-divider-title">WORKSPACE GROUPS</div>
                  )}
                  {filteredChannels.map((channel, idx) => {
                    const isActive = !activeDirectMember && channel.id === activeChannelId;
                    const lastMsg = channel.lastMessage;
                    return (
                      <div
                        key={channel.id}
                        className={`wa-chat-item ${isActive ? 'active' : ''}`}
                        onClick={() => handleOpenChannel(channel)}
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
                  })}
                </>
              )}

              {/* INDIVIDUAL TEAM MEMBERS DIRECT CHATS */}
              {filteredMembers.length > 0 && (
                <>
                  {activeFilter === 'all' && (
                    <div className="wa-list-divider-title" style={{ marginTop: '12px' }}>
                      INDIVIDUAL TEAM MEMBERS
                    </div>
                  )}
                  {filteredMembers.map((member, idx) => {
                    const isMemberActive = activeDirectMember?.id === member.id;
                    const nameColor = getNameColor(member.name);

                    return (
                      <div
                        key={member.id}
                        className={`wa-chat-item direct-item ${isMemberActive ? 'active' : ''}`}
                        onClick={() => handleOpenDirectChat(member)}
                      >
                        <div className="wa-chat-avatar direct-avatar" style={{ background: nameColor }}>
                          {initialsFor(member.name)}
                          <span className="wa-online-dot" />
                        </div>
                        <div className="wa-chat-info">
                          <div className="wa-chat-top-line">
                            <span className="wa-chat-name">{member.name}</span>
                            <span className="wa-member-role-tag">{member.role || 'Staff'}</span>
                          </div>
                          <div className="wa-chat-bottom-line">
                            <span className="wa-chat-snippet">
                              Tap to chat 1-on-1 • Direct message
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {filteredChannels.length === 0 && filteredMembers.length === 0 && (
                <div className="wa-list-empty">No conversations found</div>
              )}
            </>
          )}
        </div>
      </aside>

      {/* 3. MAIN CHAT CONVERSATION VIEW */}
      <main className="wa-conversation-view">
        {/* Top Header with Back Arrow for Mobile and Left/Right User Icons */}
        <div className="wa-convo-header">
          <div
            className="wa-convo-header-left clickable"
            onClick={() => setShowChannelInfo(true)}
            title="Click to view channel info & members"
          >
            {/* BACK ARROW (Essential for WhatsApp Mobile Experience) */}
            <button
              type="button"
              className="wa-back-arrow-btn"
              title="Back to chats"
              onClick={(e) => {
                e.stopPropagation();
                setMobileChatOpen(false);
              }}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>

            {/* Avatar */}
            <div className="wa-convo-avatar" style={{ background: currentChatInfo.isDirect ? getNameColor(currentChatInfo.title) : '#DFD6C9', color: currentChatInfo.isDirect ? '#FFFFFF' : '#54656F' }}>
              {currentChatInfo.isDirect ? (
                currentChatInfo.avatar
              ) : (
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                </svg>
              )}
            </div>

            {/* Chat Title & Subtitle */}
            <div className="wa-convo-details">
              <h2 className="wa-convo-title">{currentChatInfo.title}</h2>
              <p className="wa-convo-subtitle">{currentChatInfo.subtitle}</p>
            </div>
          </div>

          {/* Right Header Action Icons */}
          <div className="wa-convo-header-actions">
            <button
              type="button"
              className="wa-header-icon-btn"
              title="Voice call"
              onClick={() => startCall('voice')}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </button>
            <button
              type="button"
              className="wa-header-icon-btn"
              title="Video call"
              onClick={() => startCall('video')}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </button>
            <button
              type="button"
              className={`wa-header-icon-btn ${showSearchBar ? 'active' : ''}`}
              title="Search messages"
              onClick={() => setShowSearchBar(v => !v)}
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
                  <button type="button" onClick={() => { setShowMoreMenu(false); setShowChannelInfo(true); }}>
                    Channel Details
                  </button>
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
            {onCloseMobile && (
              <button
                type="button"
                className="wa-mobile-exit-btn mobile-only"
                title="Exit Fullscreen Chat"
                onClick={onCloseMobile}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Inline Message Search Bar */}
        {showSearchBar && (
          <div className="wa-search-inline-bar">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#54656F" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="wa-search-inline-input"
              placeholder={`Search messages in ${currentChatInfo.title}...`}
              value={messageSearch}
              autoFocus
              onChange={e => setMessageSearch(e.target.value)}
            />
            {messageSearch.trim() && (
              <span className="wa-search-match-badge">
                {filteredMessages.length} found
              </span>
            )}
            <button
              type="button"
              className="wa-search-close-btn"
              title="Close search"
              onClick={() => {
                setShowSearchBar(false);
                setMessageSearch('');
              }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Pinned Info Bar */}
        <div className="wa-pinned-bar">
          <span className="wa-pinned-icon">📌</span>
          <span className="wa-pinned-text">{pinnedInfo}</span>
        </div>

        {/* Messages Stream with WhatsApp Wallpaper Background */}
        <div className="wa-messages-area" ref={messagesScrollRef}>
          {error && <div className="wa-error-banner">{error}</div>}

          {loadingMessages ? (
            <div className="wa-state-loading">
              <div className="wa-spinner" />
              <span>Loading messages...</span>
            </div>
          ) : filteredMessages.length === 0 ? (
            <div className="wa-welcome-box">
              <div className="wa-lock-badge">🔒 End-to-end workspace protected</div>
              <h3>{currentChatInfo.title}</h3>
              <p>
                {currentChatInfo.isDirect
                  ? `Send a message to start direct chat with ${currentChatInfo.title}.`
                  : (currentChatInfo.description || 'Send a message to start team coordination.')}
              </p>
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
                        {!isOwn && (
                          <div className="wa-bubble-sender-row">
                            <span className="wa-bubble-sender-name" style={{ color: nameColor }}>
                              ~ {msg.senderName}
                            </span>
                            <span className="wa-bubble-sender-phone">
                              {msg.senderRole || 'Member'}
                            </span>
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

                        {/* Audio Waveform Simulator */}
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

                        {/* Timestamp & double checks */}
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

        {/* Bottom Input Bar */}
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

            {/* Text Input (Enter sends, Shift+Enter new line) */}
            <textarea
              rows={1}
              className="wa-message-input"
              placeholder={`Message ${currentChatInfo.title}...`}
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

      {/* CHANNEL / CONTACT DETAILS DRAWER ("GENERAL ICON SECTION") */}
      {showChannelInfo && (
        <div className="wa-info-drawer-backdrop" onClick={() => setShowChannelInfo(false)}>
          <div className="wa-info-drawer" onClick={e => e.stopPropagation()}>
            <div className="wa-info-drawer-header">
              <h3 className="wa-info-drawer-title">
                {currentChatInfo.isDirect ? 'Contact Info' : 'Channel Details'}
              </h3>
              <button
                type="button"
                className="wa-info-drawer-close"
                title="Close"
                onClick={() => setShowChannelInfo(false)}
              >
                ✕
              </button>
            </div>

            <div className="wa-info-drawer-body">
              {/* Profile Card */}
              <div className="wa-info-profile-card">
                <div
                  className="wa-info-avatar-large"
                  style={{
                    background: currentChatInfo.isDirect ? getNameColor(currentChatInfo.title) : '#008069'
                  }}
                >
                  {currentChatInfo.isDirect ? currentChatInfo.avatar : '👥'}
                </div>
                <h4 className="wa-info-name">{currentChatInfo.title}</h4>
                <p className="wa-info-tag">{currentChatInfo.subtitle}</p>

                {/* Quick Call Action Row */}
                <div className="wa-info-action-row">
                  <button
                    type="button"
                    className="wa-info-action-btn"
                    onClick={() => {
                      setShowChannelInfo(false);
                      startCall('voice');
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                    <span>Voice Call</span>
                  </button>
                  <button
                    type="button"
                    className="wa-info-action-btn"
                    onClick={() => {
                      setShowChannelInfo(false);
                      startCall('video');
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="23 7 16 12 23 17 23 7" />
                      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                    </svg>
                    <span>Video Call</span>
                  </button>
                  <button
                    type="button"
                    className="wa-info-action-btn"
                    onClick={() => {
                      setShowChannelInfo(false);
                      setShowSearchBar(true);
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <span>Search</span>
                  </button>
                </div>
              </div>

              {/* Description / Topic Card */}
              <div className="wa-info-section-card">
                <div className="wa-info-section-header">Description & Topic</div>
                <p style={{ margin: 0, fontSize: '13.5px', color: '#54656F', lineHeight: '1.45' }}>
                  {currentChatInfo.isDirect
                    ? `Direct confidential communication channel with ${currentChatInfo.title}.`
                    : (currentChatInfo.description || 'General team discussion, project announcements, and operations.')}
                </p>
              </div>

              {/* Channel Members List */}
              <div className="wa-info-section-card">
                <div className="wa-info-section-header">
                  <span>{currentChatInfo.isDirect ? 'Participants' : `Participants (${members.length + 1})`}</span>
                </div>

                {!currentChatInfo.isDirect && (
                  <input
                    type="text"
                    className="wa-info-member-search"
                    placeholder="Search channel participants..."
                    value={channelMemberFilter}
                    onChange={e => setChannelMemberFilter(e.target.value)}
                  />
                )}

                <div className="wa-info-member-list">
                  {/* Current User */}
                  <div className="wa-info-member-item">
                    <div className="wa-info-member-avatar" style={{ background: '#008069' }}>
                      {initialsFor(currentUser.name || 'You')}
                      <span className="wa-online-dot" />
                    </div>
                    <div className="wa-info-member-info">
                      <p className="wa-info-member-name">You ({currentUser.name})</p>
                      <span className="wa-info-member-role">{currentUser.role || 'Super Admin'} • Group Admin</span>
                    </div>
                  </div>

                  {/* Active Direct Member or Channel Members */}
                  {currentChatInfo.isDirect ? (
                    <div className="wa-info-member-item">
                      <div
                        className="wa-info-member-avatar"
                        style={{ background: getNameColor(activeDirectMember.name) }}
                      >
                        {initialsFor(activeDirectMember.name)}
                        <span className="wa-online-dot" />
                      </div>
                      <div className="wa-info-member-info">
                        <p className="wa-info-member-name">{activeDirectMember.name}</p>
                        <span className="wa-info-member-role">{activeDirectMember.role || 'Team Member'}</span>
                      </div>
                    </div>
                  ) : (
                    members
                      .filter(m => !channelMemberFilter.trim() || m.name.toLowerCase().includes(channelMemberFilter.toLowerCase()))
                      .map(m => (
                        <div key={m.id} className="wa-info-member-item">
                          <div
                            className="wa-info-member-avatar"
                            style={{ background: getNameColor(m.name) }}
                          >
                            {initialsFor(m.name)}
                            <span className="wa-online-dot" />
                          </div>
                          <div className="wa-info-member-info">
                            <p className="wa-info-member-name">{m.name}</p>
                            <span className="wa-info-member-role">{m.role || 'Member'}</span>
                          </div>
                          <button
                            type="button"
                            className="wa-info-member-call-btn"
                            title={`Call ${m.name}`}
                            onClick={() => {
                              setShowChannelInfo(false);
                              handleOpenDirectChat(m);
                              setTimeout(() => startCall('voice'), 200);
                            }}
                          >
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                            </svg>
                          </button>
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* REAL-TIME AUDIO & VIDEO CALL MODAL */}
      {callActive && (
        <div className="wa-call-overlay">
          <div className="wa-call-window">
            {/* Top Call Info Header */}
            <div className="wa-call-header">
              <div className="wa-call-header-info">
                <span className="wa-call-channel-badge">
                  {callType === 'video' ? '📹 Video Call' : '📞 Voice Call'}
                </span>
                <span className="wa-call-status-text">
                  {callStatus === 'calling' && 'Calling...'}
                  {callStatus === 'connected' && 'Connected • HD Audio'}
                  {callStatus === 'ended' && 'Call Ended'}
                </span>
              </div>
              <div className="wa-call-timer">
                {formatCallTime(callTimer)}
              </div>
            </div>

            {/* Call Screen Body */}
            <div className="wa-call-body">
              {/* Invisible autoPlay audio element for continuous bidirectional sound */}
              <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />

              {callType === 'voice' ? (
                /* Voice Call Interface */
                <div className="wa-call-audio-display">
                  <div className="wa-call-avatar-pulse">
                    {currentChatInfo.isDirect ? currentChatInfo.avatar : '👥'}
                  </div>
                  <h3 className="wa-call-name">{currentChatInfo.title}</h3>
                  <p style={{ color: '#8696A0', fontSize: '13px', margin: 0 }}>
                    {callStatus === 'calling' ? 'Ringing...' : 'Connected • Real-Time Voice Audio'}
                  </p>
                </div>
              ) : (
                /* Video Call Interface */
                <div className="wa-call-video-container">
                  {/* Remote WebRTC Video Stream Feed */}
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="wa-call-remote-video"
                  />

                  {/* Fallback Display if video camera is off / initializing */}
                  {(!remoteStreamRef.current || isVideoOff) && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'radial-gradient(circle at center, #1F2C34 0%, #0C1317 100%)',
                        color: '#FFFFFF',
                        zIndex: 1
                      }}
                    >
                      <div style={{ textAlign: 'center' }}>
                        <div
                          className="wa-call-avatar-pulse"
                          style={{ margin: '0 auto 16px', width: '90px', height: '90px', fontSize: '32px' }}
                        >
                          {currentChatInfo.isDirect ? currentChatInfo.avatar : '👥'}
                        </div>
                        <h4 style={{ margin: '0 0 6px', fontSize: '18px' }}>{currentChatInfo.title}</h4>
                        <p style={{ color: '#25D366', fontSize: '12.5px', margin: 0 }}>
                          {callStatus === 'calling' ? 'Connecting media...' : 'Real-Time HD Video Active'}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Local Self-View PiP */}
                  <div className="wa-call-local-pip">
                    <video
                      ref={localVideoRef}
                      autoPlay
                      muted
                      playsInline
                      className="wa-call-local-video"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Call Controls */}
            <div className="wa-call-footer">
              {/* Mute Mic */}
              <button
                type="button"
                className={`wa-call-ctrl-btn ${isMuted ? 'active-off' : ''}`}
                title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                onClick={toggleMute}
              >
                {isMuted ? (
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="1" y1="1" x2="23" y2="23" />
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                )}
              </button>

              {/* Camera Toggle */}
              <button
                type="button"
                className={`wa-call-ctrl-btn ${isVideoOff ? 'active-off' : ''}`}
                title={isVideoOff ? 'Turn camera on' : 'Turn camera off'}
                onClick={toggleVideo}
              >
                {isVideoOff ? (
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="1" y1="1" x2="23" y2="23" />
                    <path d="M21 21l-3.34-3.34M1 5l3.34 3.34M23 7l-7 5 7 5V7z" />
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="23 7 16 12 23 17 23 7" />
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                  </svg>
                )}
              </button>

              {/* Switch to Voice / Video */}
              <button
                type="button"
                className="wa-call-ctrl-btn"
                title={callType === 'voice' ? 'Switch to Video Call' : 'Switch to Voice Call'}
                onClick={() => {
                  if (callType === 'voice') {
                    toggleVideo();
                  } else {
                    setCallType('voice');
                  }
                }}
              >
                {callType === 'voice' ? (
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="23 7 16 12 23 17 23 7" />
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                )}
              </button>

              {/* Screen Share */}
              <button
                type="button"
                className={`wa-call-ctrl-btn ${isScreenSharing ? 'active-off' : ''}`}
                title={isScreenSharing ? 'Stop Screen Share' : 'Share Screen'}
                onClick={toggleScreenShare}
              >
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </button>

              {/* End Call Button */}
              <button
                type="button"
                className="wa-call-ctrl-btn end-call"
                title="End Call"
                onClick={endCall}
              >
                <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
                  <line x1="23" y1="1" x2="1" y2="23" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* INCOMING CALL ALERT TOAST */}
      {incomingCall && !callActive && (
        <div className="wa-incoming-call-toast">
          <div className="wa-incoming-toast-avatar">
            {initialsFor(incomingCall.from)}
          </div>
          <div>
            <h5 style={{ margin: '0 0 2px', fontSize: '14px', color: '#FFFFFF' }}>{incomingCall.from}</h5>
            <p style={{ margin: 0, fontSize: '12px', color: '#8696A0' }}>
              Incoming {incomingCall.callType === 'video' ? 'Video Call' : 'Voice Call'}...
            </p>
          </div>
          <div className="wa-incoming-toast-actions">
            <button
              type="button"
              className="wa-btn-accept-call"
              title="Accept call"
              onClick={() => acceptIncomingCall(incomingCall)}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </button>
            <button
              type="button"
              className="wa-btn-decline-call"
              title="Decline call"
              onClick={() => setIncomingCall(null)}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
