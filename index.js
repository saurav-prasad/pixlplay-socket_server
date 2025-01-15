const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config()


const app = express()
const server = http.createServer(app)
const port = process.env.PORT || 8080

// socket server initilization
const io = new Server(server, {
    cors: {
        origin: "*"
    }
})

// State variables
let onlineUsers = {}; // { userId: socketId, username: username }
let canvasAdminMap = {}; // { canvasId: adminUserId }
let canvasCollaborators = {}; // { canvasId: [userId] }

io.on('connection', (socket) => {

    // When a user goes online **
    socket.on("online", ({ userId, username, canvasId = null }) => {
        if (userId && username) {
            onlineUsers[userId] = { socketId: socket.id, username };
            // Emit the list of online users
            io.emit("get-online-users", Object.keys(onlineUsers));
        }
        // notify the collaborators that user joined the associated canvas
        Object.keys(canvasCollaborators).forEach(canv_id => {
            if (canvasCollaborators[canv_id].includes(userId)) {
                io.to(`canvas_${canv_id}`).emit('collaborator-joined', { userId, canvasId: canv_id });
            }
        })
    })

    // When the user disconnects
    socket.on('disconnect', () => {
        const disconnectedUser = Object.keys(onlineUsers).find(userId => onlineUsers[userId].socketId === socket.id);

        if (disconnectedUser) {
            delete onlineUsers[disconnectedUser];
            io.emit("disconnected-user", disconnectedUser);


            Object.keys(canvasCollaborators).forEach(canv_id => {
                if (canvasAdminMap[canv_id] === disconnectedUser) {
                    // notify the collaborators that admin is offline and updates are paused for associated canvases
                    io.to(`canvas_${canv_id}`).emit('pause-canvas', {
                        message: 'Admin has gone offline. Updates are paused.',
                    });
                }
                // notify the collaborators that user left the associated canvas
                if (canvasCollaborators[canv_id].includes(disconnectedUser)) {
                    io.to(`canvas_${canv_id}`).emit('collaborator-leaved', { userId: disconnectedUser, canvasId: canv_id });
                }
            })

        };

    });

    // Invite a user **
    socket.on('invite-user', ({ toUserId, canvasId, adminUserId }) => {
        const recipient = onlineUsers[toUserId]
        if (recipient) {
            canvasAdminMap[canvasId] = adminUserId // asssign admin for canvasId
            socket.join(`canvas_${canvasId}`);
            io.to(recipient.socketId).emit('receive-invitation', { canvasId, adminUserId });
        }
    });


    // Accept invitation **
    socket.on('accept-invitation', ({ canvasId, adminUserId }) => {
        // check if admin is online
        const recipient = onlineUsers[adminUserId];
        if (!recipient) {
            socket.emit('error', { message: 'Admin is offline or invitation invalid.' });
            return;
        }
        // check if adminUserId is the admin of canvasId
        if (canvasAdminMap[canvasId] === adminUserId) {
            socket.emit('error', { message: 'Invalid invitation.' });
            return;
        }

        // create canvasCollaborators state if not present
        if (!canvasCollaborators[canvasId]) {
            canvasCollaborators[canvasId] = [];
        }

        // get the current user's userId from onlineUsers object through current socket.id
        const userId = Object.keys(onlineUsers).find(id => onlineUsers[id].socketId === socket.id);

        // if userId is not present in canvasCollaborators canvasId's array
        if (!canvasCollaborators[canvasId].includes(userId)) {
            canvasCollaborators[canvasId].push(userId);
            socket.join(`canvas_${canvasId}`); // join the user to the room
            io.to(`canvas_${canvasId}`).emit('collaborator-joined', { userId, canvasId }); // update other users
            io.to(recipient.socketId).emit('invitation-accepted', { canvasId, userId }); // also notify the admin
        }

    });

    // Canvas update **
    socket.on('canvas-update', ({ canvasId, lines }) => {
        const userId = Object.keys(onlineUsers).find(id => onlineUsers[id].socketId === socket.id);

        // if current user is not present in canvasCollaborators 
        if (!canvasCollaborators[canvasId]?.includes(userId)) {
            socket.emit('error', { code: 'CANVAS_ACCESS_DENIED', message: 'You are not authorized to work on this canvas.' });
            return;
        }

        io.to(`canvas_${canvasId}`).emit('updated-canvas', { lines, canvasId });
    });

    // Check canvas accessibility by current user **
    socket.on('if-canvas-accessable', ({ canvasId }) => {
        const userId = Object.keys(onlineUsers).find(id => onlineUsers[id].socketId === socket.id);

        if (canvasCollaborators[canvasId]?.includes(userId)) {
            io.to(socket.id).emit("canvas-accessable", { success: true, message: "Access accepted." });
        } else {
            io.to(socket.id).emit("canvas-accessable", { success: false, message: "Access denied." });
        }
    });

    // when canvas is deleted **
    socket.on('delete-canvas', (canvasId) => {
        // canvas can only be deleted by the admin
        const userId = Object.keys(onlineUsers).find(id => onlineUsers[id].socketId === socket.id);
        if (canvasAdminMap[canvasId] == userId) {
            io.to(`canvas_${canvasId}`).emit('canvas-deleted', {
                message: 'The canvas has been deleted by the admin.',
            });
            delete canvasCollaborators[canvasId];
            delete canvasAdminMap[canvasId]
        }
    });

});


// server start
server.listen(port, (req, res) => {
    console.log("Server listening on port ", port)
})