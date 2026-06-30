import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Socket } from "socket.io";
import { PrismaService } from "../prisma/prisma.service";
import { InputMessageDto } from "./dto/inputMessage.dto";

@Injectable()
export class ChatService {
    constructor(
        private readonly jwtService: JwtService,
        private readonly prisma: PrismaService,
    ){}

    getUserIdFromSocket(client: Socket): string {
        const token = client.handshake.auth?.token;
    if (!token){
        throw new Error("Unauthorized");
    }
    let payload: any;
    try {
        payload = this.jwtService.verify(token);
    } catch {
        throw new Error("Invalid token");
    }
    const userId = payload.userId;
    if (!userId) {
        throw new Error("Invalid token payload");
    }
    return userId;
}
async joinRoom(client: Socket, friendId: string) {
    const myUserId = this.getUserIdFromSocket(client);
    if (!friendId) {
        throw new Error("friendId is required");
    }
    const dmKey = [myUserId, friendId].sort().join(":");
    const myUserData = await this.prisma.userData.findUnique({
        where: { userId: myUserId },
    });
    const friendUserData = await this.prisma.userData.findUnique({
        where: { userId: friendId },
    });
    if (!myUserData || !friendUserData) {
        throw new Error("UserData not found");
    }
    const friendship = await this.prisma.friend.findUnique({
        where: { pairKey: dmKey },
    });
    if (!friendship || friendship.status !== "ADDED") {
        throw new Error("Not friends");
    }
    let session = await this.prisma.chatSession.findUnique({
        where: { dmKey },
    });
    if (!session) {
        session = await this.prisma.chatSession.create({
            data: {
                dmKey,
                participants: {
                    create: [{ userId: myUserId }, { userId: friendId }],
                },
            },
        });
    }

    await this.prisma.chatSessionParticipant.update({
        where: {
            userId_sessionId: {
                userId: myUserId,
                sessionId: session.id,
        },
    },
    data: {
        lastReadAt: new Date(),
    },
});
    const messages = await this.prisma.message.findMany({
        where: {
            sessionId: session.id,
        },
        orderBy: {
            createdAt: "desc",
        },
        take: 50,
    });
    return { 
        roomId: session.id, 
        messages: messages.reverse(), 
        };
    }
    async sendMessage(client: Socket, data: InputMessageDto) {
        const myUserId = this.getUserIdFromSocket(client);
        const user = await this.prisma.user.findUnique({
            where: {
                id: myUserId,  
            },
        });
        if (!user) {
            throw new Error("User not found");
        }
        const participant = await this.prisma.chatSessionParticipant.findUnique({
            where: {
                userId_sessionId: {
                    userId: myUserId,
                    sessionId: data.roomId,
                },
            },
        });
        if (!participant) {
            throw new Error("Not a participant of this chat");
        }
        return await this.prisma.message.create({
            data: {
                sessionId: data.roomId,
                content: data.content,
                userId: myUserId,
                usernameSnap: user.username,
            },
        });
    }
}
