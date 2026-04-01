import jwt from "jsonwebtoken";

export const auth = (req,res,next)=>{
    try {
        const token = req.header('x-auth-token');
        // console.log("tokwn",token)
        jwt.verify(token,process.env.SECRET_KEY)
        next();
    } catch (error) {
        res.send({status:"401",error:error.message,msg:"not authorized"})
    }
}