import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || '';

let socketInstance = null;

export const getSocket = () => {
  if (!socketInstance) {
    socketInstance = io(API_URL || undefined, {
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000
    });
  }
  return socketInstance;
};

export default getSocket;
