// Import required modules
const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const ws = require('ws');
const fs = require('fs');
const {S3Client}=require('@aws-sdk/client-s3');

dotenv.config(); // Load environment variables from .env file

// Connect to MongoDB using mongoose
mongoose.connect(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => {
        console.log('Connected to MongoDB');
    })
    .catch((err) => {
        console.error('Error connecting to MongoDB:', err);
    });

// Load JWT secret and bcrypt salt
const jwtSecret = process.env.JWT_SECRET;
const bcryptSalt = bcrypt.genSaltSync(10);

// Initialize Express app
const app = express();


// Configure CORS options
const corsOptions = {
    origin: 'http://localhost:5173', // Replace with your frontend URL
    credentials: true,
};
app.use('/uploads', express.static(__dirname + '/uploads'));
app.use(cors(corsOptions)); // Enable CORS
app.use(express.json()); // Parse JSON requests
app.use(cookieParser()); // Parse cookies

// Load User and Message models (assuming you have defined these models)
const User = require('./models/User');
const Message = require('./models/Message');

// Utility function to get user data from JWT token in request
async function getUserDataFromRequest(req) {
    return new Promise((resolve, reject) => {
        const token = req.cookies?.token;
        if (token) {
            jwt.verify(token, jwtSecret, {}, (err, userData) => {
                if (err) reject(err);
                resolve(userData);
            });
        } else {
            reject('no token');
        }
    });
}

// Handle fetching messages for a specific user
app.get('/messages/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const messages = await Message.find({
            $or: [
                { sender: userId, recipient: req.userId },
                { sender: req.userId, recipient: userId },
            ]
        }).sort({ createdAt: 1 });
        res.json(messages);
    } catch (err) {
        console.error('Fetching messages error:', err);
        res.status(500).json('error');
    }
});

// Handle fetching list of users
app.get('/people', async (req, res) => {
    try {
        const users = await User.find({}, { _id: 1, username: 1 });
        res.json(users);
    } catch (err) {
        console.error('Fetching users error:', err);
        res.status(500).json('error');
    }
});

// Handle fetching user profile data
app.get('/profile', async (req, res) => {
    try {
        const userData = await getUserDataFromRequest(req);
        res.json(userData);
    } catch (err) {
        console.error('Fetching profile error:', err);
        res.status(401).json('no token');
    }
});

// Handle user login
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const foundUser = await User.findOne({ username });
        if (foundUser) {
            const passOk = bcrypt.compareSync(password, foundUser.password);
            if (passOk) {
                jwt.sign({ userId: foundUser._id, username }, jwtSecret, {}, (err, token) => {
                    if (err) {
                        console.error('JWT error:', err);
                        res.status(500).json('error');
                    } else {
                        res.cookie('token', token, { sameSite: 'none', secure: true }).status(200).json({
                            id: foundUser._id,
                            username,
                        });
                    }
                });
            } else {
                res.status(401).json('invalid credentials');
            }
        } else {
            res.status(401).json('invalid credentials');
        }
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json('error');
    }
});

// Handle user logout
app.post('/logout', (req, res) => {
    res.cookie('token', '', { sameSite: 'none', secure: true }).json('ok');
});

// Handle user registration
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const hashedPassword = bcrypt.hashSync(password, bcryptSalt);
        const createdUser = await User.create({
            username: username,
            password: hashedPassword,
        });
        jwt.sign({ userId: createdUser._id, username }, jwtSecret, {}, (err, token) => {
            if (err) {
                console.error('JWT error:', err);
                res.status(500).json('error');
            } else {
                res.cookie('token', token, { sameSite: 'none', secure: true }).status(201).json({
                    id: createdUser._id,
                    username,
                });
            }
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json('error');
    }
});

// Start Express server
const server = app.listen(4040);

// Initialize WebSocket server
const wss = new ws.WebSocketServer({ server });
wss.on('connection', (connection, req) => {
    console.log('WebSocket connected');

    // Initialize connection properties
    connection.isAlive = true;
    connection.timer = setInterval(() => {
        connection.ping();
        connection.deathTimer = setTimeout(() => {
            connection.isAlive = false;
            clearInterval(connection.timer);
            connection.terminate();
            // Notify other clients about online status change
            notifyAboutOnlinePeople();
        }, 1000);
    }, 5000);

    // Handle WebSocket 'pong' event
    connection.on('pong', () => {
        clearTimeout(connection.deathTimer);
    });

    // Handle WebSocket 'message' event
    connection.on('message', async (message) => {
        const messageData = JSON.parse(message.toString());
        const { recipient, text, file } = messageData;
        let filename = null;
        if (file) {
            console.log('size', file.data.length);
            const parts = file.name.split('.');
            const ext = parts[parts.length - 1];
            filename = Date.now() + '.'+ext;
            const path = __dirname + '/uploads/' + filename;
            const bufferData = new Buffer(file.data.split(',')[1], 'base64');
            fs.writeFile(path, bufferData, () => {
              console.log('file saved:'+path);
            });
        }
        if (recipient && (text || file)) {
            const messageDoc = await Message.create({
                sender: connection.userId,
                recipient,
                text,
                file: file ? filename : null,
            });
            // Notify recipient clients about the new message
            [...wss.clients].filter(c => c.userId === recipient).forEach(c => {
                c.send(JSON.stringify({
                    text,
                    sender: connection.userId,
                    recipient,
                    file: file ? filename : null,
                    _id: messageDoc._id,
                }));
            });
        }
    });

    // Notify all clients about online people
    function notifyAboutOnlinePeople() {
        const onlineUsers = [...wss.clients].map(c => ({ userId: c.userId, username: c.username }));
        [...wss.clients].forEach(client => {
            client.send(JSON.stringify({
                online: onlineUsers,
            }));
        });
    }

    // Handle WebSocket connection close event
    connection.on('close', () => {
        console.log('WebSocket disconnected');
        clearInterval(connection.timer);
        // Notify other clients about online status change
        notifyAboutOnlinePeople();
    });

    // Extract user data from WebSocket handshake
    const cookies = req.headers.cookie;
    if (cookies) {
        const tokenCookieString = cookies.split(';').find(str => str.trim().startsWith('token='));
        if (tokenCookieString) {
            const token = tokenCookieString.split('=')[1];
            if (token) {
                jwt.verify(token, jwtSecret, {}, (err, userData) => {
                    if (err) throw err;
                    const { userId, username } = userData;
                    connection.userId = userId;
                    connection.username = username;
                    // Notify all clients about online status change
                    notifyAboutOnlinePeople();
                });
            }
        }
     }
});