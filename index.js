require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion } = require("mongodb");

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

// MongoDB URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@roycluster.xla8ebs.mongodb.net/localChefBazaar?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB");

    const db = client.db("localChefBazaar");
    const usersCollection = db.collection("users");
    const mealsCollection = db.collection("meals");

    // ================= JWT =================
    app.post("/jwt", (req, res) => {
      const { email } = req.body;

      const token = jwt.sign({ email }, process.env.JWT_SECRET, {
        expiresIn: "1d",
      });

      res.cookie("token", token, {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
      });

      res.send({ success: true });
    });

    app.post("/logout", (req, res) => {
      res.clearCookie("token", {
        httpOnly: true,
        sameSite: "lax",
      });
      res.send({ success: true });
    });

    // ================= USERS =================
    app.post("/api/users", async (req, res) => {
      const user = req.body;
      const exists = await usersCollection.findOne({ email: user.email });

      if (exists) {
        return res.send({ message: "User already exists" });
      }

      const result = await usersCollection.insertOne({
        ...user,
        role: "user",
        status: "active",
        createdAt: new Date(),
      });

      res.send(result);
    });

    // ================= MEALS =================
    app.get("/meals", async (req, res) => {
      const sort = req.query.sort === "desc" ? -1 : 1;

      const result = await mealsCollection
        .find()
        .sort({ price: sort })
        .toArray();

      res.send(result);
    });

    // Single meal
    app.get("/meals/:id", async (req, res) => {
      const id = req.params.id;
      const result = await mealsCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

  } finally {
    // keep server running
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("✅ LocalChefBazaar Server Running");
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});

app.get("/reviews", async (req, res) => {
  const result = await reviewsCollection.find().toArray();
  res.send(result);
});
