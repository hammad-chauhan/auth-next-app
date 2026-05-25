import connect from '@/dbConfig/dbConfig';
import { errorResponse } from '@/helpers/apiResponse';
import User from '@/models/userModel';
import { NextRequest, NextResponse } from 'next/server';
import bcryptjs from 'bcryptjs';

export async function POST(request: NextRequest) {
  try{
    await connect();

    const reqBody = await request.json();
    const {username, email, password} = reqBody;
    console.log(reqBody);

    //Check if user exists
    const user = await User.findOne({email});

    if (user){
      return NextResponse.json({error: 'User already exists'}, {status: 400});
    }

    //hash password
    const salt = await bcryptjs.genSalt(10);
    const hashedPassword = await bcryptjs.hash(password, salt);

    const newUser = new User({
      username,
      email,
      password: hashedPassword
    });

    const savedUser = await newUser.save();
    console.log(savedUser);

    return NextResponse.json({message: 'User created Successfully', success: true, savedUser});

  }catch(error: unknown){
    return errorResponse(error);
  }
}
