import { UsePipes, ValidationPipe } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, SubscribeMessage,
    MessageBody, ConnectedSocket } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from "./chat.service";
import { InputMessageDto } from './dto/inputMessage.dto';

@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
@WebSocketGateway({ namespace: '/chat', cors: { origin: '*' } })
export class ChatGateway {
    @WebSocketServer()
    server: Server;

    private socketToUser = new Map<string, string>();
    private userSockets = new Map<string, Set<string>>();

    constructor(private readonly chatService: ChatService) {}

    handleConnection(client: Socket) {
        try {
            const userId = this.chatService.getUserIdFromSocket(client);
            this.socketToUser.set(client.id, userId);
            if (!this.userSockets.has(userId)) this.userSockets.set(userId, new Set());
            const sockets = this.userSockets.get(userId)!;
            if (sockets.size === 0) this.server.emit('presence', { userId, online: true });
            sockets.add(client.id);
        } catch {
            client.disconnect();
        }
    }

    handleDisconnect(client: Socket) {
        const userId = this.socketToUser.get(client.id);
        this.socketToUser.delete(client.id);
        if (!userId) return;
        const sockets = this.userSockets.get(userId);
        if (!sockets) return;
        sockets.delete(client.id);
        if (sockets.size === 0) {
            this.userSockets.delete(userId);
            this.server.emit('presence', { userId, online: false });
        }
    }

    @SubscribeMessage('getOnlineUsers')
    handleGetOnlineUsers(@ConnectedSocket() client: Socket) {
        client.emit('onlineUsers', Array.from(this.userSockets.keys()));
    }
    @SubscribeMessage("joinRoom")
    async joinRoom(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { friendId: string },
    ){
        const result = await this.chatService.joinRoom(client, data.friendId);
        await client.join(result.roomId);
        client.emit("roomJoined", {
            roomId: result.roomId,
            messages: result.messages,
        });
    }
    @SubscribeMessage("sendMessage")
    async sendMessage(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: InputMessageDto,
    ) {
        const message = await this.chatService.sendMessage(
            client, data,
        );
        this.server.to(data.roomId).emit("newMessage", message);
    }
}
