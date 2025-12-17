require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

const app = express();
const port = process.env.PORT || 5000;

/*MIDDLEWARE*/
app.use(
  cors({
    origin: "http://localhost:5173", // frontend
    credentials: true,
  })
);

//Preflight fix
app.options("*", cors());

app.use(express.json());
app.use(cookieParser());

/*MONGODB*/
const { MongoClient, ServerApiVersion } = require("mongodb");

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@roycluster.xla8ebs.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let usersCollection;

async function run() {
  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db("localChefBazaarDB");
    usersCollection = db.collection("users");
  } catch (error) {
    console.error(error);
  }
}
run();

/*JWT ROUTES*/
app.post("/api/users/jwt", (req, res) => {
  const email = req.body.email;

  const token = jwt.sign({ email }, process.env.JWT_SECRET, {
    expiresIn: "1d",
  });

  res
    .cookie("token", token, {
      httpOnly: true,
      secure: false, // localhost
      sameSite: "lax",
    })
    .send({ success: true });
});

app.post("/logout", (req, res) => {
  res
    .clearCookie("token", {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
    })
    .status(200)
    .send({ message: "Logged out successfully" });
});

/*SAVE USER*/
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

/*ROOT*/
app.get("/", (req, res) => {
  res.send("LocalChefBazaar Server Running");
});

app.listen(port, () => {
  console.log("Server running on port", port);
});
