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
    console.log(" Connected to MongoDB");

    const db = client.db("localChefBazaar");
    const usersCollection = db.collection("users");
    const mealsCollection = db.collection("meals");


    // JWT
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

    //  USERS 
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

    //  MEALS 
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


// reviews
app.get("/reviews", async (req, res) => {
  try {
    const result = await reviewsCollection.find().toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to load reviews" });
  }
});

// Chef / Admin Request API
app.post("/role-requests", async (req, res) => {
  const request = req.body;
  request.requestStatus = "pending";
  request.requestTime = new Date();

  const result = await roleRequestCollection.insertOne(request);
  res.send(result);
});

//Orders

app.get("/orders", async (req, res) => {
  const email = req.query.email;
  const result = await ordersCollection.find({ userEmail: email }).toArray();
  res.send(result);
});

// Stripe Payment
app.post("/create-payment-intent", async (req, res) => {
  const { orderId, price } = req.body;

  const amount = parseInt(price * 100);

  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: "bdt",
    payment_method_types: ["card"],
  });

  res.send({ clientSecret: paymentIntent.client_secret });
});

//Payment Success
app.post("/payments", async (req, res) => {
  const payment = req.body;

  const paymentResult = await paymentsCollection.insertOne(payment);

  await ordersCollection.updateOne(
    { _id: new ObjectId(payment.orderId) },
    { $set: { paymentStatus: "paid" } }
  );

  res.send(paymentResult);
});
