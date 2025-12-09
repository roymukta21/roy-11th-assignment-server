require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// mongo
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri);

let usersCollection;

async function run() {
  await client.connect();
  const db = client.db("localChefBazaarDB");
  usersCollection = db.collection("users");
}
run();

// ✅ JWT api
app.post("/api/users/jwt", async (req, res) => {
  const email = req.body.email;
  const token = jwt.sign({ email }, process.env.JWT_SECRET, {
    expiresIn: "1d",
  });

  res
    .cookie("token", token, {
      httpOnly: true,
      secure: false, // production এ true
      sameSite: "lax",
    })
    .send({ success: true });
});

app.get("/api/users/logout", (req, res) => {
  res.clearCookie("token").send({ success: true });
});

// ✅ Save user
app.post("/api/users", async (req, res) => {
  const user = req.body;
  const exists = await usersCollection.findOne({ email: user.email });

  if (exists) {
    return res.send({ message: "User already exists" });
  }

  const result = await usersCollection.insertOne({
    email: user.email,
    role: "user",
    createdAt: new Date(),
  });

  res.send(result);
});

app.get("/", (req, res) => {
  res.send("LocalChefBazaar Server Running ✅");
});

app.listen(port, () => {
  console.log("Server running on port", port);
});
