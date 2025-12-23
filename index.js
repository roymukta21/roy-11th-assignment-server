// Import dependencies
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(`${process.env.STRIPE_KEY}`);
//firebase-admin auth
const admin = require("firebase-admin");
const serviceAccount = require("./local-chef-bazaar.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});


// Create app
const app = express();
const port = process.env.PORT || 5000;

//Middleware
app.use(express.json());
app.use(cors());

// jwt verifactions
const verifyFirebaseToken = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "Unauthorised access" });
  }
  //console.log(token)

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    //console.log(decoded)
    next();
  } catch (err) {
    return res.status(401).send({ message: "Unauthorised access" });
  }
};

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
    const database = client.db("localChefBazaar")
    const usersCollection = database.collection("users");
    const mealsCollection = database.collection("meals");
    const mealsReviewsCollection = database.collection("mealsReviews");
    const favoritesCollection = database.collection("favorites");
    const requestsCollection = database.collection("requests");
    const ordersCollection = database.collection("orders");
    const paymentCollection = database.collection("payments");
    const counterCollection = database.collection("counters");

    const getNextChefId = async () => {
      const chefPera = await counterCollection.findOne({ _id: "chefId" });
      chefPera.seq = chefPera.seq + 1;
      const counter = await counterCollection.updateOne(
        { _id: "chefId" },
        { $set: chefPera }
      );
      console.log("counter", counter);
      const number = String(chefPera.seq).padStart(3, "0");
      return `CHEF_${number}`;
    };
    // must be used after verifyFBToken middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      //console.log(query)
      const user = await usersCollection.findOne(query);
      //console.log(user)
      if (!user || user.role !== "Admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };
    const verifyChef = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== "chef") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };
    
    
    app.get("/api/users", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.email = email;
      }
      try {
        const cursor = usersCollection.find(query).sort({ createdAt: -1 });
        const result = await cursor.toArray();
        res.send(result);
      } catch (error) {
        res.send(error);
      }
    });
    app.get("/api/users/email", verifyFirebaseToken, async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.email = email;
      }
      const result = await usersCollection.findOne(query);
      res.send(result);
    });
    app.get("/api/users/:email/role", verifyFirebaseToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ role: user?.role || "user" });
    });
    app.post("/api/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.userStatus = "active";
      user.createdAt = new Date();

      // exists user checking
      const userExists = await usersCollection.findOne({ email: user.email });
      if (userExists) {
        return res.send({ message: "User Exists" });
      }
      const result = await usersCollection.insertOne(user);
      console.log("result", result);

      res.send(result);
    });
    app.patch(
      "/api/users/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const updatedData = req.body;
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: updatedData,
        };
        const result = await usersCollection.updateOne(query, updateDoc);
        res.send(result);
      }
    );
    app.get(
      "/admin-stats",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const orders = await ordersCollection.find().toArray();
        const users = await usersCollection.find().toArray();

        const paidOrders = orders.filter((o) => o.paymentStatus === "paid");

        const totalPayment = paidOrders.reduce(
          (sum, o) => sum + o.price * Number(o.quantity),
          0
        );

        const deliveredOrders = orders.filter(
          (o) => o.orderStatus === "delivered"
        ).length;

        const pendingOrders = orders.filter(
          (o) => o.orderStatus !== "delivered"
        ).length;

        console.log(totalPayment, deliveredOrders, pendingOrders);

        res.send({
          totalPayment,
          totalUsers: users.length,
          deliveredOrders,
          pendingOrders,
        });
      }
    );

    // requests
    app.post("/requests", async (req, res) => {
      try {
        const request = req.body;

        if (!request.userEmail || !request.requestType) {
          return res.status(400).send({ message: "Invalid request data" });
        }

        const reqExists = await requestsCollection.findOne({
          userEmail: request.userEmail,
          requestType: request.requestType,
        });

        if (reqExists) {
          return res.status(409).send({
            message: "Already requested!",
          });
        }

        const result = await requestsCollection.insertOne(request);
        res.status(201).send(result);
      } catch (error) {
        res.status(500).send({ message: "Request failed" });
      }
    });
    // get request
    app.get("/requests", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const { email } = req.query;
      const query = {};
      if (email) {
        query.userEmail = email;
      }
      const result = await requestsCollection
        .find(query)
        .sort({ requestTime: -1 })
        .toArray();
      res.send(result);
    });

    app.patch(
      "/requests/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const requestId = req.params.id;
        const { action } = req.body;

        const requestQuery = { _id: new ObjectId(requestId) };
        const request = await requestsCollection.findOne(requestQuery);

        console.log("request", request);

        if (!request) {
          return res.status(404).send({ message: "Request not found" });
        }

        if (request.requestStatus !== "pending") {
          return res.send({ message: "Already processed" });
        }

        // reject
        if (action === "reject") {
          const result = await requestsCollection.updateOne(requestQuery, {
            $set: { requestStatus: "rejected" },
          });

          return res.send({ success: true, type: "rejected", result });
        }

        // accept
        if (action === "accept") {
          const userQuery = { email: request.userEmail };
          
          // console.log(user);
          if (request.requestType === "chef") {
            const chefId = await getNextChefId();

            console.log("chefId", chefId, userQuery);

            await usersCollection.updateOne(userQuery, {
              $set: {
                role: "chef",
                chefId,
              },
            });
          }

          if (request.requestType === "admin") {
            await usersCollection.updateOne(userQuery, {
              $set: { role: "admin" },
            });
          }

          const result = await requestsCollection.updateOne(requestQuery, {
            $set: { requestStatus: "approved" },
          });

          return res.send({ success: true, type: "approved", result });
        }
      }
    );
    // Meals data from MongoDB
    app.get("/meals", async (req, res) => {
      try {
        const {
          search = "",
          sort = "none",
          page = 1,
          limit = 10,
          email,
        } = req.query;

        let query = {};

        if (email) {
          query.chefEmail = email;
        }

        if (search) {
          query.$or = [
            { chefName: { $regex: search, $options: "i" } },
            { chefId: { $regex: search, $options: "i" } },
          ];
        }

        let sortQuery = {};
        if (sort === "low") sortQuery.price = 1;
        if (sort === "high") sortQuery.price = -1;

        const skip = (Number(page) - 1) * Number(limit);

        const meals = await mealsCollection
          .find(query)
          .sort(sortQuery)
          .skip(skip)
          .limit(Number(limit))
          .toArray();

        const total = await mealsCollection.countDocuments(query);

        res.send({
          meals,
          total,
        });
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });

    // latest meals for home page
    app.get("/latest-meals", async (req, res) => {
      const cursor = mealsCollection.find().limit(8).sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });
    app.get("/meals/:id", verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await mealsCollection.findOne(query);
      res.send(result);
    });
    app.post("/meals", verifyFirebaseToken, verifyChef, async (req, res) => {
      try {
        const meal = req.body;

        const user = await usersCollection.findOne({
          email: req.body.email,
        });

        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        if (user.userStatus === "fraud") {
          return res.status(403).send({
            message: "You are a fraud user. You cannot add meals.",
          });
        }

        meal.createdAt = new Date();
        const result = await mealsCollection.insertOne(meal);

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to create meal" });
      }
    });

    app.delete(
      "/meals/:id",
      verifyFirebaseToken,
      verifyChef,
      async (req, res) => {
        const { id } = req.params;
        const query = { _id: new ObjectId(id) };
        const result = await mealsCollection.deleteOne(query);
        res.send(result);
      }
    );
    app.patch(
      "/meals/:id",
      verifyFirebaseToken,
      verifyChef,
      async (req, res) => {
        const id = req.params.id;
        const updatedData = req.body;
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: updatedData,
        };
        const result = await mealsCollection.updateOne(query, updateDoc);
        res.send(result);
      }
    );

    
    app.get("/meals-reviews/:mealId", verifyFirebaseToken, async (req, res) => {
      const mealId = req.params.mealId;
      const query = { mealId: new ObjectId(mealId) };
      const cursor = mealsReviewsCollection.find(query).sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });
    app.get("/meals-reviews", verifyFirebaseToken, async (req, res) => {
      const { email } = req.query;
      const query = {};
      if (email) {
        query.userEmail = email;
      }
      const result = await mealsReviewsCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });
    app.get("/latest-reviews", async (req, res) => {
      const cursor = mealsReviewsCollection
        .find()
        .limit(8)
        .sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });
    app.post("/meals-reviews", async (req, res) => {
      const { mealId, mealName, userName, userEmail, UserPhoto, text, rating } =
        req.body;
      if (!mealId || !text || !rating) {
        return res.status(400).send({ message: "Invalid review data" });
      }
      // const formattedDate = dayjs().format("MMM D, YYYY h:mm A");
      const UserReviews = {
        mealId: new ObjectId(mealId),
        mealName,
        userName,
        userEmail,
        UserPhoto,
        text,
        rating,
        createdAt: new Date(),
      };
      const result = await mealsReviewsCollection.insertOne(UserReviews);
      res.send(result);
    });
    app.delete("/meals-reviews/:id", verifyFirebaseToken, async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await mealsReviewsCollection.deleteOne(query);
      res.send(result);
    });
    app.patch("/meals-reviews/:id", verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: updatedData,
      };
      const result = await mealsReviewsCollection.updateOne(query, updateDoc);
      res.send(result);
    });
    app.get("/favorites", verifyFirebaseToken, async (req, res) => {
      const { email } = req.query;
      const query = {};
      if (email) {
        query.userEmail = email;
      }
      const cursor = favoritesCollection.find(query).sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });
    app.post("/favorites", async (req, res) => {
      const favorite = req.body;
      favorite.createdAt = new Date();
      favorite.mealId = new ObjectId(favorite.mealId);
      if (!favorite.mealId) {
        return res.status(400).send({ message: "Invalid favorite data" });
      }

      //  check already in favorites
      const favoriteExists = await favoritesCollection.findOne({
        mealId: favorite.mealId,
        userEmail: favorite.userEmail,
      });

      if (favoriteExists) {
        return res.send({ message: "Already in favorites" });
      }

      const result = await favoritesCollection.insertOne(favorite);
      res.send({ message: "Added successfully", result });
    });
    app.delete("/favorites/:id", verifyFirebaseToken, async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await favoritesCollection.deleteOne(query);
      res.send(result);
    });
    // order data from UI
    app.get("/orders", verifyFirebaseToken, async (req, res) => {
      const { email, mealId, chefId } = req.query;
      const query = {};
      if (email) {
        query.userEmail = email;
      }
      if (mealId) {
        query.mealId = new ObjectId(mealId);
      }

      if (chefId) {
        query.chefId = chefId;
      }

      const result = await ordersCollection
        .find(query)
        .sort({ orderTime: -1 })
        .toArray();
      res.send(result);
    });
    app.get("/orders/:id", verifyFirebaseToken, async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await ordersCollection.find(query).toArray();
      res.send(result);
    });
    // order data post data
    app.post("/orders", async (req, res) => {
      try {
        const orders = req.body;
        const user = await usersCollection.findOne({ email: orders.email });

        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        if (user.userStatus === "fraud") {
          return res.status(403).send({
            message: "You are marked as a fraud user. You cannot place orders.",
          });
        }
        //  normal user order
        orders.mealId = new ObjectId(orders.mealId);
        orders.orderTime = new Date();
        orders.orderStatus = "pending";
        orders.paymentStatus = "pending";

        const result = await ordersCollection.insertOne(orders);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Something went wrong" });
      }
    });

    app.patch(
      "/orders/:id",
      verifyFirebaseToken,
      verifyChef,
      async (req, res) => {
        const { id } = req.params;
        const { status } = req.body;

        const order = await ordersCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!order) {
          return res.send({ message: "Order not found" });
        }

        let updateDoc = {};

        // accepted
        if (status === "accepted") {
          updateDoc = {
            orderStatus: "accepted",
            paymentStatus: "payment",
          };
        }

        // cancelled
        if (status === "cancelled") {
          updateDoc = {
            orderStatus: "cancelled",
            paymentStatus: "cancelled",
          };
        }

        //  delivered
        if (status === "delivered") {
          updateDoc = {
            orderStatus: "delivered",
          };
        }

        await ordersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateDoc }
        );

        res.send({ success: true });
      }
    );

    //Stripe payment option setup
    app.post("/create-checkout-session", async (req, res) => {
      try {
        const paymentInfo = req.body;
        const amount = parseInt(paymentInfo.price) * 100;

        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "USD",
                unit_amount: amount,
                product_data: {
                  name: paymentInfo.mealName,
                },
              },
              quantity: 1,
            },
          ],
          customer_email: paymentInfo.userEmail,
          mode: "payment",
          metadata: {
            orderId: paymentInfo.orderId, 
            mealName: paymentInfo.mealName,
          },
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/orders`,
        });

        res.send({ url: session.url });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Checkout session failed" });
      }
    });

    // payment related apis
    app.get("/payments", async (req, res) => {
      const email = req.query.email;
      const query = {};
      
      const cursor = paymentCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.patch("/payment-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        if (!sessionId) {
          return res.status(400).send({ error: "session_id missing" });
        }

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status !== "paid") {
          return res.send({ success: false });
        }

        const transactionId = session.payment_intent;

        //  double payment check
        const exist = await paymentCollection.findOne({ transactionId });
        if (exist) {
          return res.send({
            success: true,
            payment: exist,
            message: "already processed",
          });
        }

        //  order status
        const orderId = session.metadata.orderId;
        await ordersCollection.updateOne(
          { _id: new ObjectId(orderId) },
          { $set: { paymentStatus: "paid" } }
        );

        //  payment
        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          orderId,
          mealName: session.metadata.mealName,
          transactionId,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
        };

        const result = await paymentCollection.insertOne(payment);

        return res.send({
          success: true,
          payment: {
            _id: result.insertedId,
            ...payment,
          },
        });
      } catch (err) {
        console.error("payment-success error:", err);
        res.status(500).send({ error: "payment failed" });
      }
    });

  
    console.log("✅ Successfully connected to MongoDB!");
  } finally {
    
  }
}
run().catch(console.dir);

// Default route
app.get("/", (req, res) => {
  res.send(" 🚀  Server running");
});

// Start server
app.listen(port, () => {
  console.log(`Server running : ${port}`);
});
