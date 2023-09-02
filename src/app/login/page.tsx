"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import toast from "react-hot-toast";


export default function LoginPage(){
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState({
    email: "",
    password: ""
  });

  const onLogin = async () => {
    try {
      setLoading(true)
      const response = await axios.post("/api/users/login", user)
      console.log(response.data)
      toast.success("Login Success")
      router.push("/profile")
    } catch (error: any) {
      console.log("Login Failed", error.message)
      toast.error(error.message)
    }finally{
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2">
      <h1>{loading ? "Processing": "Login"}</h1>
      <hr />
      <label htmlFor="email">email</label>
      <input type="text" id="email" className="text-black" value={user.email} onChange={(e)=> setUser({...user, email: e.target.value})} placeholder="email"/>
      <label htmlFor="password">password</label>
      <input type="password" id="password" className="text-black" value={user.password} onChange={(e)=> setUser({...user, password: e.target.value})} placeholder="password"/>
      <button onClick={onLogin}>Login here</button>
      <Link href="/signup">Visit Signup Page</Link>
    </div>
  )
}