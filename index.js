const express = require('express');
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config()
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ error: true, message: 'unauthorized access' });
  }
  // bearer token
  const token = authorization.split(' ')[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ error: true, message: 'unauthorized access' })
    }
    req.decoded = decoded;
    next();
  })
}


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.n3rdf37.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    //client.connect();
    const usersCollection = client.db("LearnLingoDB").collection("users");
    const coursesCollection = client.db("LearnLingoDB").collection("classes");
    const selectedCollection = client.db("LearnLingoDB").collection("select");
    const paymentCollection = client.db("LearnLingoDB").collection("payments")
    app.post('/jwt', (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
      res.send({ token })
    })

    // Warning: use verifyJWT before using verifyAdmin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email }
      const user = await usersCollection.findOne(query);
      if (user?.role !== 'admin') {
        return res.status(403).send({ error: true, message: 'forbidden message' });
      }
      next();
    }
    const verifyInstructor = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email }
      const user = await usersCollection.findOne(query);
      if (user?.role !== 'instructor') {
        return res.status(403).send({ error: true, message: 'forbidden message' });
      }
      next();
    }
    //all classes
    app.get('/classes', async (req, res) => {
      const result = await coursesCollection.find({ status: 'approve' }).toArray();
      res.send(result);
    });

    //get popular classes
    app.get('/popular-classes', async (req, res) => {
      const courses = await coursesCollection.find().toArray();
      const sortedCourses = courses.sort((a, b) => b.enrolled - a.enrolled);
      const topCourses = sortedCourses.slice(0, 6);
      res.json(topCourses);
    });
    //all classes api for admin pannel
    app.get('/all-classes', verifyJWT, verifyAdmin, async (req, res) => {
      const result = await coursesCollection.find().toArray();
      res.send(result);
    });
    // my class for instructors 
    app.get('/my-classes', verifyJWT, verifyInstructor, async (req, res) => {
      const email = req.decoded.email;
      const classes = await coursesCollection.find({ instructorEmail: email }).toArray();
      res.json(classes);
    });
    // for add new class
    app.post('/classes', verifyJWT, verifyInstructor, async (req, res) => {
      const classes = req.body;
      const result = await coursesCollection.insertOne(classes)
      res.send(result);
    });
    //for update approve data
    app.put('/classes/approve/:id', async (req, res) => {
      const classId = req.params.id;
      const filter = { _id: new ObjectId(classId) }
      const updateData = {
        $set: {
          status: 'approve'
        }
      }
      const result = await coursesCollection.updateOne(filter, updateData);
      res.send(result);
    });
    //for update deny data
    app.put('/classes/deny/:id', async (req, res) => {
      const classId = req.params.id;
      const filter = { _id: new ObjectId(classId) }
      const updateData = {
        $set: {
          status: 'denied'
        }
      }
      const result = await coursesCollection.updateOne(filter, updateData);
      res.send(result);
    });
    //for sending feedback
    app.post('/classes/feedback/:classId', async (req, res) => {
      const classId = req.params.classId;
      const feedback = req.body.feedback;
      const result = await coursesCollection.updateOne(
        { _id: new ObjectId(classId) },
        { $set: { feedback: feedback } }
      );
      res.send(result)
    });

    //get popular instructors
    app.get('/popular-instructors', async (req, res) => {
      //   const instructors = await coursesCollection.find().toArray();
      //   const sortedInstructors = instructors.sort((a, b) => b.enrolled - a.enrolled);
      //   const topInstructor = sortedInstructors.slice(0, 6);
      //   res.json(topInstructor);
      //
      try {
        const courses = await coursesCollection.find().toArray();

        const instructors = [];
        const instructorEmails = courses.map(course => course.instructorEmail);

        for (const email of instructorEmails) {
          const instructor = await usersCollection.findOne({ email, role: 'instructor' });
          if (instructor) {
            instructors.push(instructor);
          }
        }

        const sortedInstructors = instructors.sort((a, b) => {
          const enrolledA = courses.find(course => course.instructorEmail === a.email)?.enrolled || 0;
          const enrolledB = courses.find(course => course.instructorEmail === b.email)?.enrolled || 0;
          return enrolledB - enrolledA;
        });

        const topInstructors = sortedInstructors.slice(0, 6);

        const instructorsWithCourses = topInstructors.map(instructor => {
          const instructorCourses = courses.filter(course => course.instructorEmail === instructor.email);
          const courseInfo = instructorCourses.map(course => {
            return {
              className: course.className,
              enrolled: course.enrolled
            };
          });

          return {
            name: instructor.name,
            email: instructor.email,
            photoURL: instructor.photoURL,
            courses: courseInfo
          };
        });

        res.json(instructorsWithCourses);
      } catch (err) {
        console.log('Error retrieving popular instructors:', err);
        res.status(500).send('Error retrieving popular instructors');
      }

    });

    //for instructors api
    app.get('/all-instructors', async (req, res) => {
      const instructors = await usersCollection.find({ role: 'instructor' }).toArray();
      const courses = await coursesCollection.find().toArray();

      const instructorData = instructors.map((instructor) => {
        const coursesByInstructor = courses.filter((course) => course.instructorEmail === instructor.email);

        return {
          instructorImage: instructor.photoURL,
          courses: coursesByInstructor
        };
      });

      res.send(instructorData);
    });

    // users related apis
    app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // security layer: verifyJWT
    // email same
    // check admin
    //for useAdmin
    app.get('/users/admin/:email', verifyJWT, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        res.send({ admin: false })
      }

      const query = { email: email }
      const user = await usersCollection.findOne(query);
      const result = { admin: user?.role === 'admin' }
      res.send(result);
    });
    //for useInstructor
    app.get('/users/instructor/:email', verifyJWT, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        res.send({ instructor: false })
      }

      const query = { email: email }
      const user = await usersCollection.findOne(query);
      const result = { instructor: user?.role === 'instructor' }
      res.send(result);
    });

    app.post('/users', async (req, res) => {
      const user = req.body;
      console.log(user.email);
      const query = { email: user.email }
      const existingUser = await usersCollection.findOne(query);

      if (existingUser) {
        return res.send({ message: 'user already exists' })
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });


    //for make instructor
    app.patch('/users/constructor/:id', async (req, res) => {
      const id = req.params.id;
      // console.log(id);
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: "instructor"
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);

    });
    //for make admin
    app.patch('/users/admin/:id', async (req, res) => {
      const id = req.params.id;
      // console.log(id);
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: "admin"
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);

    });

    //for my selected class
    app.get('/select/:id', async (req, res) => {
      const itemId = req.params.id;
      console.log(itemId);
      const item = await selectedCollection.findOne({ _id: new ObjectId(itemId) });
      res.send(item);
    });


    app.get('/select', verifyJWT, async (req, res) => {
      const email = req.query.email;

      if (!email) {
        res.send([]);
      }

      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res.status(403).send({ error: true, message: 'forbidden access' })
      }

      const query = { email: email };
      const result = await selectedCollection.find(query).toArray();
      res.send(result);
    });

    //for select item stor database
    app.post('/select', async (req, res) => {
      const item = req.body;
      const result = await selectedCollection.insertOne(item);
      res.send(result);
    })

    app.delete('/select/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await selectedCollection.deleteOne(query);
      res.send(result);
    })
    // create payment intent
    app.post('/create-payment', verifyJWT, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card']
      });

      res.send({
        clientSecret: paymentIntent.client_secret
      })
    })
    //for enrolled class
    app.get('/payments/classes', verifyJWT, async (req, res) => {
      const result = await paymentCollection.find().toArray();
      res.send(result);
    });

    //payment history
    app.get('/payments/history', verifyJWT, async (req, res) => {
      const paymentHistory = await paymentCollection.find().sort({ date: -1 }).toArray();
      res.send(paymentHistory);
    });

    app.post('/payments', verifyJWT, async (req, res) => {
      try {
        const payment = req.body;
        const insertResult = await paymentCollection.insertOne(payment);
        const itemId = payment.selectItems;
        const classId = payment.classItems;
        console.log(classId);
        const deleteResult = await selectedCollection.deleteOne({ _id: new ObjectId(itemId) });
        const query = { _id: new ObjectId(classId) };
        const update = { $inc: { seats: -1, enrolled: 1 } };
        const courseUpdateResult = await coursesCollection.updateOne(query, update);

        if (courseUpdateResult.acknowledged) {
          res.send({ insertResult, deleteResult, acknowledged: courseUpdateResult.acknowledged });
          console.log({ insertResult, deleteResult, acknowledged: courseUpdateResult.acknowledged });
        } else {
          throw new Error('Error updating seats and enrolled count');
        }
      } catch (err) {
        console.error('Error updating seats and enrolled count:', err);
        res.status(500).send('Error updating seats and enrolled count');
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('lingo is sitting')
})

app.listen(port, () => {
  console.log(`Lingo is sitting on port ${port}`);
})
