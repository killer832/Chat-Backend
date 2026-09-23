import "dotenv/config";
import http from "http";
import { Server } from "socket.io";
import express from "express";
import JWT from "jsonwebtoken";
import { User } from "./Models/user.model.js";
import { Message } from "./Models/messages.model.js";
import bcrypt from "bcrypt";
import connectDB from "./DB/connect.db.js";

const port = process.env.PORT || 3000;

connectDB();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const onlineUsers = new Map();
const jwtSecret = process.env.JWT_SECRET;
app.use(express.json());

app.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (
      typeof username !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string" ||
      !username.trim() ||
      !email.trim() ||
      !password.trim()
    ) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    const existedUser = await User.findOne({
      $or: [{ email }, { username }],
    });

    if (existedUser) {
      return res.status(409).json({
        message: "User with email or username already exists",
      });
    }

    const user = await User.create({
      username,
      email,
      password: await bcrypt.hash(password, 10),
    });

    const token = JWT.sign({ id: user._id, username: username }, jwtSecret);
    res.status(200).json({
      message: "user register sucessfully",
      username: user.username,
      email: user.email,
      Token: `Bearer ${token}`,
    });
  } catch (error) {
    console.error("Register error:", error);

    res.status(400).json({
      message: error.message,
    });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password.trim()
    ) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        message: "Invalid email or password",
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const token = JWT.sign(
      { id: user._id, username: user.username },
      jwtSecret,
    );
    res.status(200).json({
      message: "Login successful",
      username: user.username,
      email: user.email,
      Token: `Bearer ${token}`,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      message: "Internal server error",
    });
  }
});

io.use((socket, next) => {
  try {
    const authHeader = socket.handshake.headers["authorization"];

    if (!authHeader) return next(new Error("Auth header is missing"));

    const token = authHeader.split(" ")[1];

    const decodedToken = JWT.verify(token, jwtSecret);

    if (!decodedToken) return next(new Error("Invalid auth token"));

    socket.user = decodedToken;
    next();
  } catch (error) {
    console.log("Something went wrong with decoding the token", error);

    next(new Error("Authentication error: Invalid token"));
  }
});

io.on("connection", async (socket) => {
  try {
    console.log("A user is connected:", socket.id);

    const username = socket.user.username;
    const userId = socket.user.id;

    if (!username || !userId) {
      console.error("Invalid user data");
      socket.disconnect();
      return;
    }

    onlineUsers.set(username, socket.id);

    // ==============================
    // SEND PENDING MESSAGES
    // ==============================

    const pendingMessages = await Message.find({
      receiver: userId,
      delivered: false,
    })
      .populate("sender", "username")
      .sort({ createdAt: 1 });

    for (const message of pendingMessages) {
      socket.emit("message", {
        id: message._id,
        from: message.sender.username,
        message: message.content,
        deliveredAt: message.deliveredAt,
      });

      message.delivered = true;
      message.deliveredAt = new Date();

      await message.save();
    }

    // ==============================
    // NEW MESSAGE
    // ==============================

    socket.on("message", async ({ to, data }) => {
      try {
        if (!to || !data) {
          throw new Error("Recipient and message are required");
        }

        const receiver = await User.findOne({
          username: to,
        });

        if (!receiver) {
          throw new Error("Invalid recipient");
        }

        const receiverSocketId = onlineUsers.get(to);

        // Always save the message
        const message = await Message.create({
          sender: socket.user.id,
          receiver: receiver._id,
          content: data,
          delivered: !!receiverSocketId,
          deliveredAt: receiverSocketId ? new Date() : null,
        });

        // Send immediately if online
        if (receiverSocketId) {
          io.to(receiverSocketId).emit("message", {
            id: message._id,
            from: socket.user.username,
            message: message.content,
            deliveredAt: message.deliveredAt,
          });
        }
      } catch (error) {
        console.error("Message error:", error);
      }
    });

    socket.on("message-expired", async ({ messageId }) => {
      try {
        const message = await Message.findOne({
          _id: messageId,
          receiver: socket.user.id,
          isActive: true,
        });

        if (!message) {
          return;
        }

        if (!message.deliveredAt) {
          return;
        }

        const TEN_MINUTES = 10 * 60 * 1000;

        const elapsed = Date.now() - message.deliveredAt.getTime();

        if (elapsed >= TEN_MINUTES) {
          message.isActive = false;
          await message.save();

          console.log(
            `Message ${messageId} expired for ${socket.user.username}`,
          );
        }
      } catch (error) {
        console.error(
          "Error occurred while marking message as expired:",
          error,
        );
      }
    });

    // ==============================
    // DISCONNECT
    // ==============================

    socket.on("disconnect", () => {
      onlineUsers.delete(username);
      console.log(`${username} disconnected`);
    });
  } catch (error) {
    console.error("Connection error:", error);
  }
});

server.listen(port, () => {
  console.log(`Server is running on port : ${port} `);
});
