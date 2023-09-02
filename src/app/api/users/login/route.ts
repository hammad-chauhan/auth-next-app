import connect from "@/dbConfig/dbConfig"
import User from "@/models/userModel"
import { NextRequest, NextResponse } from "next/server"
import bcryptjs from "bcryptjs"
import jwt from "jsonwebtoken"

connect()

export async function POST(request: NextRequest) {
  try{
    const reqBody = await request.json()
    const {email, password} = reqBody
    console.log(reqBody)

    //Check if user exists
    const user = await User.findOne({email})

    if (!user){
      return NextResponse.json({error: "User Does not exists"}, {status: 400})
    }

    //authenticate user
    const validPassword = await bcryptjs.compare(password, user.password)
    if(!validPassword){
      return NextResponse.json({error: "Invalid password"}, {status: 400})
    }

    //create token data
    const tokenData = {id: user.id, username: user.username, email: user.email}
    //create token
    const token = await jwt.sign(tokenData, process.env.TOKEN_SECRET!, {expiresIn: "1d"})

    //setting token to user cookies
    const response = NextResponse.json({message: "Login Successfully", success: true})
    response.cookies.set("token", token, {
      httpOnly: true,
    })

    return response

  }catch(error: any){
    return NextResponse.json({error: error.message}, {status: 500})
  }
}