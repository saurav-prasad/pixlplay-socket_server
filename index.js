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
let onlineUsers = {}; // { userId, username, profilePhoto,socketId }
let canvasAdminMap = {}; // { canvasId: adminUserId }
let canvasCollaborators = {}; // { canvasId: [ { userId, username, profilePhoto },] }

function isCanvasCollaboratorPresent(canvasId, userId) {
    let flag = false
    canvasCollaborators[canvasId]?.map((data) => {
        if (data?.userId === userId) {
            flag = true
        }
    })
    return flag
}

io.on('connection', (socket) => {

    // When a user goes online **
    socket.on("online", ({ userId, username, profilePhoto }) => {
        // console.log(userId, username, profilePhoto)
        if (userId && username) {
            onlineUsers[userId] = { socketId: socket.id, username, userId, profilePhoto };
            // Emit the list of online users
            io.emit("get-online-users", onlineUsers);
        }
        // notify the collaborators that user joined the associated canvas
        Object.keys(canvasCollaborators).forEach(canv_id => {
            if (isCanvasCollaboratorPresent(canv_id, userId)) {
                socket.join(`canvas_${canv_id}`)
                io.to(`canvas_${canv_id}`).emit('collaborator-joined', {
                    collaborators: canvasCollaborators[canv_id],
                    canvasId: canv_id
                }); // update other users  
            }
            if (Object.keys(canvasAdminMap).includes(canv_id)) {
                if (canvasAdminMap[canv_id] === userId) {
                    io.to(`canvas_${canv_id}`).emit('collaborator-joined', {
                        collaborators: canvasCollaborators[canv_id],
                        canvasId: canv_id
                    });
                    socket.join(`canvas_${canv_id}`)
                }
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
                    io.to(`canvas_${canv_id}`).emit("error", { message: 'Admin has gone offline. Updates are paused.' })
                }
                // notify the collaborators that user left the associated canvas
                if (isCanvasCollaboratorPresent(canv_id, disconnectedUser)) {
                    io.to(`canvas_${canv_id}`).emit('collaborator-leaved', { userId: disconnectedUser, canvasId: canv_id });
                }
            })

        };

    });

    // Invite a user **
    socket.on('invite-user', ({ toUserId, canvasId, }) => {
        const recipient = onlineUsers[toUserId]
        const adminUser = onlineUsers[Object.keys(onlineUsers).find(id => onlineUsers[id].socketId === socket.id)]
        if (recipient && !isCanvasCollaboratorPresent(canvasId, toUserId)) {
            canvasAdminMap[canvasId] = adminUser.userId // asssign admin for canvasId
            socket.join(`canvas_${canvasId}`);
            io.to(recipient.socketId).emit('receive-invitation', {
                canvasId,
                adminUserId: adminUser.userId,
                adminProfilePhoto: adminUser.profilePhoto,
                username: adminUser.username,
            });
        } else {
            console.log(adminUser)
            console.log(onlineUsers)
            io.to(adminUser.socketId).emit("error", { message: "User already joined the canvas." })
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
        if (canvasAdminMap[canvasId] !== adminUserId) {
            socket.emit('error', { message: 'Invalid invitation.' });
            return;
        }

        // create canvasCollaborators state if not present
        if (!canvasCollaborators[canvasId]) {
            canvasCollaborators[canvasId] = [];
        }

        // get the current user's userId from onlineUsers object through current socket.id
        const userId = Object.keys(onlineUsers).find(id => onlineUsers[id].socketId === socket.id)

        // if userId is not present in canvasCollaborators canvasId's array
        if (!isCanvasCollaboratorPresent(canvasId, userId)) {
            canvasCollaborators[canvasId].push({
                userId,
                profilePhoto: onlineUsers[userId].profilePhoto,
                username: onlineUsers[userId].username
            });
            socket.join(`canvas_${canvasId}`); // join the user to the room
            io.to(`canvas_${canvasId}`).emit('collaborator-joined', {
                collaborators: canvasCollaborators[canvasId],
                canvasId
            }); // update other users
            io.to(recipient.socketId).emit('invitation-accepted', { canvasId, userId, message: `${onlineUsers[userId].username} joined the canvas` }); // also notify the admin
        }

    });

    // Canvas update **
    socket.on('canvas-update', ({ canvasId, lines }) => {
        const userId = Object.keys(onlineUsers).find(id => onlineUsers[id].socketId === socket.id);

        // if current user is not present in canvasCollaborators 
        if (!isCanvasCollaboratorPresent(canvasId, userId)) {
            socket.emit('error', { code: 'CANVAS_ACCESS_DENIED', message: 'You are not authorized to work on this canvas.' });
            return;
        }

        io.to(`canvas_${canvasId}`).emit('updated-canvas', { lines, canvasId });
    });

    // Check canvas accessibility by current user **
    socket.on('if-canvas-accessable', ({ canvasId }) => {
        const userId = Object.keys(onlineUsers).find(id => onlineUsers[id].socketId === socket.id);

        if (isCanvasCollaboratorPresent(canvasId, userId)) {
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

    // when user is removed by the admin
    socket.on('remove-user', ({ adminUserId, canvasId, toUserId }) => {
        const recipient = onlineUsers[toUserId]
        console.log("object")
        console.log(recipient)
        console.log(isCanvasCollaboratorPresent(canvasId, toUserId))
        console.log(canvasAdminMap[canvasId], adminUserId)
        if (recipient && isCanvasCollaboratorPresent(canvasId, toUserId) && (canvasAdminMap[canvasId] === adminUserId)) {
            console.log("object")
            const newCanvasCollaborators = canvasCollaborators[canvasId].filter(({ userId }) => userId !== toUserId)
            canvasCollaborators[canvasId] = [...newCanvasCollaborators]
            io.to(`canvas_${canvasId}`).emit('collaborator-leaved', { userId: toUserId, canvasId });
        }
    })

});


// server start
server.listen(port, (req, res) => {
    console.log("Server listening on port ", port)
})