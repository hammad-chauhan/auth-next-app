"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "react-hot-toast";


export default function SignupPage(){
  const router = useRouter()
  const [user, setUser] = useState({
    username: "",
    email: "",
    password: ""
  });

  const [loading, setLoading] = useState(false)

  const [buttonDisabled, setButtonDisabled] = useState(false);

  const onSignup = async () => {

    try {
      setLoading(true);
      const response = await axios.post("/api/users/signup", user);
      console.log("Signup Success", response.data);
      router.push("/login");
    } catch (error: any) {
      console.log("Signup Failed", error.message);
      toast.error(error.message);
    }finally{
      setLoading(false);
    }

  }

  useEffect(()=>{
    if(user.email.length > 0 && user.password.length > 0 && user.username.length > 0){
      setButtonDisabled(false)
    }else{
      setButtonDisabled(true)
    }
  }, [user])

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2">
      <h1>{ loading ? "Processing" : "Signup"}</h1>
      <hr />
      <label htmlFor="username">username</label>
      <input type="text" id="username" className="text-black" value={user.username} onChange={(e)=> setUser({...user, username: e.target.value})} placeholder="username"/>
      <label htmlFor="email">email</label>
      <input type="text" id="email" className="text-black" value={user.email} onChange={(e)=> setUser({...user, email: e.target.value})} placeholder="email"/>
      <label htmlFor="password">password</label>
      <input type="password" id="password" className="text-black" value={user.password} onChange={(e)=> setUser({...user, password: e.target.value})} placeholder="password"/>
      <button onClick={onSignup}>{buttonDisabled ? "No Signup" : "Signup Here"}</button>
      <Link href="/login">Visit Login Page</Link>
    </div>
  )
}