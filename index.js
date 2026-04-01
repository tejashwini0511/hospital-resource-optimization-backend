import express from "express";
import dotenv from "dotenv";
import { MongoClient , ObjectId } from "mongodb";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cors from "cors";
import { auth } from "./User/auth.js";

dotenv.config();
const app = express();
app.use(express.json());
app.use(cors())
// const port = 9000;

const MONGO_URL = process.env.MONGO_URL;

async function createConnection(){
    try{
        const client = new MongoClient(MONGO_URL);
        await client.connect();
        console.log("MONGO CONNECTED");
        return client;
    }
    catch(err){
        console.error("Server not connected:", err);
        throw new Error("Database connection failed");
    }
}

const client = await createConnection().catch(err => {
    console.error(err.message,"Server not connected")
    process.exit(1);
});

app.post("/signup",async (req,res)=>{
    const {name, mail, phone, password, usertype, secretkey} = req.body;

    if(usertype !== "doctor" && usertype !== "user"){
        res.send({status: 401, msg: "Invalid user type"});
        return;
    }

    if (usertype === "doctor") {
        const findSeller = await client
        .db("medical")
        .collection("doctor")
        .findOne({mail: mail});

        if (findSeller) {
            res.status(400).send({status: "401", msg: "Doctor data already exists"});
            return;
        }
        if ((usertype === "doctor") && (secretkey !== process.env.user_key)) {
            res.send({status: 401, msg: "Invalid secret key"});
            return;
        }
    }
    else if(usertype === "user"){

        // Check if the user or doctor already exists
        const findUser = await client
        .db("medical")
        .collection("user")
        .findOne({mail: mail});
    
        if (findUser) {
            res.status(400).send({status: "401", msg: "User already exists"});
            return;
        }
    }

    const hashedPassword = await genPassword(password);
    const user = await client
        .db("medical")
        .collection(usertype === "doctor" ? "doctor" : "user")
        .insertOne({name: name, mail: mail, phone: phone, password: hashedPassword, userType: usertype});
    
    res.send({status: "200", msg: "Successfully registered", user, name});
})

async function genPassword(password){
    const salt = await bcrypt.genSalt(5);
    // console.log("salt",salt)
    const hashedPassword = await bcrypt.hash(password,salt)
    // console.log("hashedPass",hashedPassword)
    return hashedPassword;
}

app.post("/login",async (req,res)=>{
    const {mail,password,userType} = req.body;
    // console.log(mail,password)

    const findUser = await client
        .db("medical")
        .collection(userType === "doctor" ? "doctor" : "user")
        .findOne({mail:mail})

    if(!findUser){
        res.status(401).send({status:"401",msg:"User not found, Please signup."})
        return
    }
    const storedPassword = findUser.password;
    const passwordMatch = await bcrypt.compare(password,storedPassword);

    if(passwordMatch){
        const token = jwt.sign({id:findUser._id},process.env.SECRET_KEY)
        res.send({status:"200",msg:"Successfully login",token:token,userType:findUser.userType,name:findUser.name,id:findUser._id});
        return
    }
    else{
        res.status(401).send({status:"401",msg:"Invalid Credential, Please try again"})
        return
    }
}) 

app.post("/doctor/add/availability/:sellerId",auth,async (req,res)=>{

    const doctorData = req.body; // doctorData is a single doctorData object  

    try {

        if(!req.params.sellerId){
            return res.status(400).json({message:"doctorId is required"})
        }

        let Obj_id = new ObjectId(req.params.sellerId);

        const doctor = await client
        .db("medical")
        .collection("doctor")
        .findOne({_id: Obj_id});
    
        if (!doctor) {
            return res.status(404).json({ message: 'Doctor not found' });
        }
    
        if (!doctor.products) {
            doctor.products = [];
        }

        // Check if availability date already exists
        const availabilityExists = doctor?.availability?.some(data => 
            data.availability === doctorData.availability
        );


        if (availabilityExists) {
            return res.status(404).json({ message: 'This date is already created' });
        }

        const productWithId = { ...doctorData, id: new ObjectId() }; // Generate a unique ID for the product
        doctor.products.push(productWithId);
        await client.db("medical").collection("doctor").updateOne({_id: Obj_id}, {$set: {availability: doctor.products}});
    
        res.status(200).json({ message: 'Details Added successfully', doctor });
    } catch (error) {
        res.status(500).json({ message: 'Error adding Details', error });
    } 
})

app.post("/book/appoinment/:userId/:doctorId",auth,async (req,res)=>{

    const doctorData = req.body;

    const userId = req.params.userId;
    const doctorId = req.params.doctorId;

    try {

        if(!userId || !doctorId){
            return res.status(400).json({message:"Both userId and doctorId are required"});
        }

        // Find user
        const user = await client
            .db("medical")
            .collection("user")
            .findOne({_id: new ObjectId(userId)});
        if(!user) {
            return res.status(404).json({message: "User not found"});
        }

        // Find doctor
        const doctor = await client
            .db("medical")
            .collection("doctor") 
            .findOne({_id: new ObjectId(doctorId)});

        if(!doctor) {
            return res.status(404).json({message: "Doctor not found"});
        }

        // Create booking object
        const bookingDetails = {
            id: new ObjectId(),
            userId: userId,
            userName: user.name,
            doctorId: doctorId,
            doctorName: doctor.name,
            speciality: doctor.speciality,
            status: doctorData?.status ? doctorData?.status : "not-paid",
            bookingDate: new Date(),
        };

        // Add booking to user's bookings array
        if(!user.bookings) {
            user.bookings = [];
        }
        user.bookings.push(bookingDetails);
        await client.db("medical").collection("user").updateOne(
            {_id: new ObjectId(userId)},
            {$set: {bookings: user.bookings}}
        );

        // Add booking to doctor's bookings array
        if(!doctor.bookings) {
            doctor.bookings = [];
        }
        doctor.bookings.push(bookingDetails);
        await client.db("medical").collection("doctor").updateOne(
            {_id: new ObjectId(doctorId)},
            {$set: {bookings: doctor.bookings}}
        );

        res.status(200).json({
            message: `${doctorData?.status ? "Booking request sent, please pay the amount." : "Booking"}`,
            booking: bookingDetails
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({message: 'Error creating booking', error});
    }
})

app.post("/change/appoinment/status/:userId/:doctorId",auth,async (req,res)=>{

    const doctorData = req.body;

    const userId = req.params.userId;
    const doctorId = req.params.doctorId;

    try {

        if(!userId || !doctorId){
            return res.status(400).json({message:"Both userId and doctorId are required"});
        }

        // Find user
        const user = await client
            .db("medical")
            .collection("user")
            .findOne({_id: new ObjectId(userId)});

        if(!user) {
            return res.status(404).json({message: "User not found"});
        }

        // Find doctor
        const doctor = await client
            .db("medical")
            .collection("doctor") 
            .findOne({_id: new ObjectId(doctorId)});

        if(!doctor) {
            return res.status(404).json({message: "Doctor not found"});
        }  

        // Add booking to user's bookings array

        await client.db("medical").collection("user").updateOne(
            { _id: new ObjectId(userId) },
            { $set: { "bookings.$[booking].status": doctorData?.status } },
            { 
              arrayFilters: [ 
                { "booking.id": new ObjectId(doctorData?.bookingId) }
              ] 
            }
        );

        await client.db("medical").collection("doctor").updateOne(
            {_id: new ObjectId(doctorId)},
            {$set: { "bookings.$[booking].status": doctorData?.status } },
            { 
              arrayFilters: [ 
                { "booking.id": new ObjectId(doctorData?.bookingId) }
              ] 
            }
        );

        res.status(200).json({
            message: `${doctorData?.status === "paid" ? "Payment successful, waiting for confirmation." : "Payment failed."}`,
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({message: 'Error creating booking', error});
    }
})

app.get("/doctor/my/availability/:sellerId",auth,async (req,res)=>{
    try {
        const sellerId = req.params.sellerId;
        const seller = await client.db("medical").collection("doctor").findOne({_id: new ObjectId(sellerId)});
        res.send(seller.products);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching products', error });
    }
})

app.get("/get/all/availed-doctors",async (req,res)=>{
    try {
        const products = await client.db("medical").collection("doctor").aggregate([
            { $unwind: "$availability" },
            { $project: {
                _id: 0,
                treatments: "$availability.treatments",
                image: "$availability.image",
                name: "$availability.name",
                experience: "$availability.experience",
                speciality: "$availability.speciality",
                availability: "$availability.availability",
                id: "$availability.id",
                doctor_id: "$_id",
                // sellCount: "$products.sellCount"
            }}
        ]).toArray();
        res.send(products);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching product', error });
    }
})

app.post("/all/meetings/:doctorId",async (req,res)=>{
    const doctorId = req.params.doctorId;
    try {
        const doctor = await client.db("medical").collection("doctor").findOne(
            { _id: new ObjectId(doctorId) }
        );

        if (!doctor) {
            return res.status(404).json({ message: 'Doctor not found' });
        }

        const bookings = doctor.bookings || [];
        const doctorData = {
            _id: doctor._id,
            bookings: bookings.map(booking => ({
                id: booking.id,
                userId: booking.userId,
                userName: booking.userName,
                doctorId: booking.doctorId,
                doctorName: booking.doctorName,
                speciality: booking.speciality,
                status: booking.status,
                bookingDate: booking.bookingDate
            }))
        };
        res.status(200).json(doctorData);

    } catch (error) {
        res.status(500).json({ message: 'Error fetching bookings', error });
    }
})

app.post("/user/meetings/:userId",async (req,res)=>{
    const userId = req.params.userId;
    try {
        const user = await client.db("medical").collection("user").findOne(
            { _id: new ObjectId(userId) }
        );

        if (!user) {
            return res.status(404).json({ message: 'user not found' });
        }

        const bookings = user.bookings || [];
        const userData = {
            _id: user._id,
            bookings: bookings.map(booking => ({
                id: booking.id,
                userId: booking.userId,
                userName: booking.userName,
                doctorId: booking.doctorId,
                doctorName: booking.doctorName,
                speciality: booking.speciality,
                status: booking.status,
                bookingDate: booking.bookingDate
            }))
        };
        res.status(200).json(userData);

    } catch (error) {
        res.status(500).json({ message: 'Error fetching', error });
    }
})

const port = process.env.PORT ?? 5000;

app.listen(port,()=>{
    console.log(port,"server connected successfully");
})