const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const User = require('./models/User');
const Message = require('./models/Message');
const ws = require('ws');
const fs=require('fs');

dotenv.config();

mongoose.connect(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => {
        console.log('Connected to MongoDB');
    })
    .catch((err) => {
        console.error('Error connecting to MongoDB:', err);
    });

const jwtSecret = process.env.JWT_SECRET;
const bcryptSalt = bcrypt.genSaltSync(10);

const app = express();

const corsOptions = {
    origin: 'http://localhost:5173',
    credentials: true,
};
app.use('/uploads',express.static(__dirname+'/uploads'));
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

async function getUserDataFromRequest(req) {
    return new Promise((resolve, reject) => {
        const token = req.cookies?.token;
        if (token) {
            jwt.verify(token, jwtSecret, {}, (err, userData) => {
                if (err) throw err;
                resolve(userData);
            });
        } else {
            reject('no token');
        }
    });
}

app.get('/messages/:userId', async (req, res) => {
    const { userId } = req.params;
    const userData = await getUserDataFromRequest(req);
    const ourUserId = userData.userId;
    const messages = await Message.find({
        sender: { $in: [userId, ourUserId] },
        recipient: { $in: [userId, ourUserId] },
    }).sort({ createdAt: 1 });
    res.json(messages);
});

app.get('/people',async(req,res)=>{
  const users=await User.find({},{'_id':1,username:1});
  res.json(users);
});

app.get('/profile', (req, res) => {
    const { token } = req.cookies;
    if (token) {
        jwt.verify(token, jwtSecret, {}, (err, userData) => {
            if (err) {
                console.error('JWT verification error:', err);
                res.status(401).json('invalid token');
            } else {
                res.json(userData);
            }
        });
    } else {
        res.status(401).json('no token');
    }
});

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

app.post('/logout',(req,res)=>{
    res.cookie('token','',{sameSite:'none',secure:true}).json('ok');
});

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

const server = app.listen(4040);

const wss = new ws.WebSocketServer({ server });
wss.on('connection', (connection, req) => {

    function notifyAboutOnlinePeople(){
        [...wss.clients].forEach(client => {
            client.send(JSON.stringify({
                online: [...wss.clients].map(c => ({ userId: c.userId, username: c.username })),
            }));
        });
    }
    connection.isAlive=true;
    connection.timer=setInterval(()=>{
        connection.ping();
        connection.deathTimer=setTimeout(() => {
            connection.isAlive=false;
            clearInterval(connection.timer);
            connection.terminate();
            notifyAboutOnlinePeople();
        }, 1000);
    },5000);

    connection.on('pong',()=>{
        clearTimeout(connection.deathTimer);
    });

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

                    const clientsData = [...wss.clients].map(c => ({ userId: c.userId, username: c.username }));
                    notifyAboutOnlinePeople();
                });
            }
        }
    }
    connection.on('message', async (message) => {
        const messageData = JSON.parse(message.toString());
        const { recipient, text,file} = messageData;
        let filename=null;
        if(file){
            
            const parts=file.name.split('.');
            const ext=parts[parts.length-1];
            filename=Date.now()+'.'+ext;
            const path=__dirname+'/Uploads/'+filename;
            const bufferData=new Buffer.from(file.data.split(',')[1],'base64');
            fs.writeFile(path,bufferData,()=>{
                console.log('file save'+path)
            });

        }
        if (recipient && (text||file)) {
            const messageDoc = await Message.create({
                sender: connection.userId,
                recipient,
                text,
                file:file?filename:null,
            });
            console.log("created msg");            
            [...wss.clients].filter(c => c.userId === recipient).forEach(c => c.send(JSON.stringify({
                text,
                sender: connection.userId,
                recipient,
                file:file?filename:null,
                _id: messageDoc._id,
            })) );
        }
    });
});