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
let canvasesState = {} // { canvasId: lines }

function isCanvasCollaboratorPresent(canvasId, userId) {
    let flag = false
    canvasCollaborators[canvasId]?.map((data) => {
        if (data?.userId === userId) {
            flag = true
        }
    })
    return flag
}

function mapAllCollaboratorCanvases(userId) {
    let canvasArr = []
    Object.keys(canvasCollaborators).map((id) => {
        canvasCollaborators[id].map(data => {
            if (data.userId === userId) {
                canvasArr.push({ canvasId: id, canvasName: data.canvasName })
            }
        })
    })
    return canvasArr
}

io.on('connection', (socket) => {


    // When a user goes online **
    socket.on("online", ({ userId, username, profilePhoto }) => {
        try {
            // console.log(socket)
            console.log(socket.id)
            console.log({ userId, username, profilePhoto })
            // console.log(userId, username, profilePhoto)
            if (userId && username) {
                onlineUsers[userId] = { socketId: socket.id, username, userId, profilePhoto };
                // Emit the list of online users
                io.emit("get-online-users", onlineUsers);
                console.log(" 1 object")
            }
            // notify the collaborators that user joined the associated canvas
            Object.keys(canvasCollaborators).forEach(canv_id => {
                //collaborators
                console.log(" 2 object")
                if (isCanvasCollaboratorPresent(canv_id, userId)) {
                    console.log(" 3 object")
                    socket.join(`canvas_${canv_id}`)
                    if (onlineUsers[canvasAdminMap[canv_id]]) {
                        io.to(`canvas_${canv_id}`).emit('collaborator-joined', {
                            collaborators: [...canvasCollaborators[canv_id], {
                                username: onlineUsers[canvasAdminMap[canv_id]].username,
                                userId: onlineUsers[canvasAdminMap[canv_id]].userId,
                                profilePhoto: onlineUsers[canvasAdminMap[canv_id]].profilePhoto
                            }],
                            canvasId: canv_id
                        }); // update other users  
                    }
                }
                // admin
                if (Object.keys(canvasAdminMap).includes(canv_id)) {
                    console.log(" 4 object")
                    if (canvasAdminMap[canv_id] === userId) {
                        if (onlineUsers[canvasAdminMap[canv_id]]) {
                            io.to(`canvas_${canv_id}`).emit('collaborator-joined', {
                                collaborators: [...canvasCollaborators[canv_id], {
                                    username: onlineUsers[canvasAdminMap[canv_id]].username,
                                    userId: onlineUsers[canvasAdminMap[canv_id]].userId,
                                    profilePhoto: onlineUsers[canvasAdminMap[canv_id]].profilePhoto
                                }],
                                canvasId: canv_id
                            });
                        }
                        canvasCollaborators[canv_id]?.map(({ userId }) => {
                            io.to(onlineUsers[userId]?.socketId).emit("error", { message: 'Admin is Online.' })
                        })
                        const adminOfCanvases = Object.keys(canvasAdminMap).filter(id => canvasAdminMap[id] === userId)
                        io.to(socket.id).emit('get-admin-of-canvases', adminOfCanvases);
                        socket.join(`canvas_${canv_id}`)
                    }
                }
            })
        } catch (error) {
            console.error(error)
        }
    })

    // When the user disconnects
    socket.on('disconnect', () => {
        try {
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
        } catch (error) {
            console.error(error)
        }
    });

    // get all the canvas id of current collaborator
    socket.on("get-all-collaborator-canvases", () => {
        const userId = Object.keys(onlineUsers).find(id => onlineUsers[id].socketId === socket.id)

        const data = mapAllCollaboratorCanvases(userId)
        socket.emit("all-collaborator-canvases", data)
    })

    // Invite a user **
    socket.on('invite-user', ({ toUserId, canvasId, lines, canvasName }) => {
        try {
            const recipient = onlineUsers[toUserId]
            const adminUser = onlineUsers[Object.keys(onlineUsers).find(id => onlineUsers[id].socketId === socket.id)]
            if (recipient && !isCanvasCollaboratorPresent(canvasId, toUserId) && adminUser) {
                canvasAdminMap[canvasId] = adminUser.userId // asssign admin for canvasId
                socket.join(`canvas_${canvasId}`);
                io.to(recipient.socketId).emit('receive-invitation', {
                    canvasId,
                    canvasName,
                    adminUserId: adminUser.userId,
                    adminProfilePhoto: adminUser.profilePhoto,
                    username: adminUser.username,
                });
                // console.log(lines)
                canvasesState[canvasId] = lines
            } else if (isCanvasCollaboratorPresent(canvasId, toUserId)) {
                // console.log(adminUser)
                // console.log(onlineUsers)
                io.to(adminUser.socketId).emit("error", { message: "User already joined the canvas." })
            } else {
                socket.emit("error", { message: "Something went wrong" })
            }
        } catch (error) {
            console.error(error)
        }
    });

    // Accept invitation **
    socket.on('accept-invitation', ({ canvasId, adminUserId, canvasName }) => {
        try {
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
                    username: onlineUsers[userId].username,
                    canvasName

                });
                socket.join(`canvas_${canvasId}`); // join the user to the room
                const data = mapAllCollaboratorCanvases(userId)
                socket.emit("all-collaborator-canvases", data)
                // join the admin to the room
                // io.to(recipient.socketId).socketsJoin(socket.id);
                io.to(`canvas_${canvasId}`).emit('collaborator-joined', {
                    collaborators: [...canvasCollaborators[canvasId], {
                        username: recipient.username,
                        userId: recipient.userId,
                        profilePhoto: recipient.profilePhoto
                    }],
                    canvasId
                }); // update other users
                // admin notification
                io.to(recipient.socketId).emit('invitation-accepted', { canvasId, userId, message: `${onlineUsers[userId].username} joined the canvas` });
                const adminOfCanvases = Object.keys(canvasAdminMap).filter(id => canvasAdminMap[id] === adminUserId)
                io.to(recipient.socketId).emit('get-admin-of-canvases', adminOfCanvases);
            }
        } catch (error) {
            console.error(error)
        }

    });

    // Canvas update **
    socket.on('canvas-update', ({ canvasId, lines }) => {
        try {
            const userId = Object.keys(onlineUsers).find(id => onlineUsers[id].socketId === socket.id);

            // if current user is not present in canvasCollaborators 
            // if (!isCanvasCollaboratorPresent(canvasId, userId) || canvasAdminMap[canvasId] !== userId) {
            //     socket.emit('error', { code: 'CANVAS_ACCESS_DENIED', message: 'You are not authorized to work on this canvas.' });
            //     return;
            // }
            // console.log(onlineUsers[userId]?.username)
            io.to(`canvas_${canvasId}`).emit('updated-canvas', { lines, canvasId });
            canvasesState[canvasId] = lines
        } catch (error) {
            console.error(error)
        }
    });

    // Check canvas accessibility by current user **
    socket.on('if-canvas-accessable', ({ canvasId }) => {
        try {
            const userId = Object.keys(onlineUsers).find(id => onlineUsers[id].socketId === socket.id);

            if (isCanvasCollaboratorPresent(canvasId, userId)) {
                io.to(socket.id).emit("canvas-accessable", { success: true, message: "Access accepted.", lines: canvasesState[canvasId] });
            } else {
                io.to(socket.id).emit("canvas-accessable", { success: false, message: "Access denied." });
            }
        } catch (error) {
            console.error(error)
        }
    });

    // when canvas is deleted **
    socket.on('delete-canvas', (canvasId) => {
        try {
            // canvas can only be deleted by the admin
            const userId = Object.keys(onlineUsers).find(id => onlineUsers[id].socketId === socket.id);
            if (canvasAdminMap[canvasId] == userId) {
                io.to(`canvas_${canvasId}`).emit('canvas-deleted', {
                    message: 'The canvas has been deleted by the admin.',
                });
                canvasCollaborators[canvasId].map((data) => {
                    const newData = mapAllCollaboratorCanvases(data.userId)
                    io.to(`canvas_${canvasId}`).emit("all-collaborator-canvases", newData)
                    io.to(`canvas_${canvasId}`).emit('collaborator-leaved', { userId: data.userId, canvasId });
                    io.to(`canvas_${canvasId}`).emit("error", { message: "Admin deleted the canvas." })
                })
                delete canvasCollaborators[canvasId]
                delete canvasAdminMap[canvasId]
            }
        } catch (error) {
            console.error(error)
        }
    });

    // when user is removed by the admin
    socket.on('remove-user', ({ adminUserId, canvasId, toUserId }) => {
        try {
            const recipient = onlineUsers[toUserId]
            if (recipient && isCanvasCollaboratorPresent(canvasId, toUserId) && (canvasAdminMap[canvasId] === adminUserId)) {
                const newCanvasCollaborators = canvasCollaborators[canvasId].filter(({ userId }) => userId !== toUserId)
                canvasCollaborators[canvasId] = [...newCanvasCollaborators]
                io.to(`canvas_${canvasId}`).emit('collaborator-leaved', { userId: toUserId, canvasId });
                io.to(recipient.socketId).emit("error", { message: "You were removed by the admin." })
            }
        } catch (error) {
            console.error(error)
        }
    })

    // when user leave the canvas
    socket.on('leave-canvas', ({ canvasId }) => {
        try {
            const userId = Object.keys(onlineUsers).find(id => onlineUsers[id].socketId === socket.id);
            if (isCanvasCollaboratorPresent(canvasId, userId)) {
                const newCanvasCollaborators = canvasCollaborators[canvasId].filter((data) => data.userId !== userId)
                canvasCollaborators[canvasId] = [...newCanvasCollaborators]
                const data = mapAllCollaboratorCanvases(userId)
                socket.emit("all-collaborator-canvases", data)
                io.to(`canvas_${canvasId}`).emit('collaborator-leaved', { userId, canvasId });
                io.to(`canvas_${canvasId}`).emit('error', { message: `${onlineUsers[userId].username} left.` });
                socket.emit("can-leave-canvas", { success: true })
            } else {
                socket.emit("can-leave-canvas", { success: false })
            }
        } catch (error) {
            console.error(error)
        }
    })
    // check if canvas can be leaved
    socket.on('can-leave-canvas', (canvasId) => {
        try {
            const userId = Object.keys(onlineUsers).find(id => onlineUsers[id].socketId === socket.id);
            if (isCanvasCollaboratorPresent(canvasId, userId)) {
                socket.emit("if-leave-canvas", { success: true })
            } else {
                socket.emit("if-leave-canvas", { success: false })
            }
        } catch (error) {
            console.error(error)
        }
    })
});


// server start
server.listen(port, (req, res) => {
    console.log("Server listening on port ", port)
})