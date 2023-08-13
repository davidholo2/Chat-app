import React, { useContext, useState } from "react";
import axios from "axios";
import { UserContext } from "./UserContext";

export default function RegisterAndLoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoginOrRegister, setIsLoginOrRegister] = useState("register");
  const { setUsername: setLoggedInUsername, setId } = useContext(UserContext);

  async function handleSubmit(ev) {
    ev.preventDefault();
    const url = isLoginOrRegister === "register" ? "register" : "login";
    const { data } = await axios.post(
      url,
      { username, password },
      { withCredentials: true }
    );
    setLoggedInUsername(username);
    setId(data.id);
  }

  return (
    <div className="bg-blue-50 h-screen flex items-center justify-center">
      <form
        className="bg-white p-8 rounded-md shadow-md"
        onSubmit={handleSubmit}
      >
        <h2 className="text-2xl font-semibold mb-4">
          {isLoginOrRegister === "register" ? "Register" : "Login"}
        </h2>
        <input
          value={username}
          onChange={(ev) => setUsername(ev.target.value)}
          type="text"
          placeholder="Username"
          className="w-full mb-2 p-2 rounded-sm border focus:outline-none focus:border-blue-500"
        />
        <input
          value={password}
          onChange={(ev) => setPassword(ev.target.value)}
          type="password"
          placeholder="Password"
          className="w-full mb-4 p-2 rounded-sm border focus:outline-none focus:border-blue-500"
        />
        <button className="bg-blue-500 text-white w-full py-2 rounded-sm">
          {isLoginOrRegister === "register" ? "Register" : "Login"}
        </button>
        <p className="text-center mt-4">
          {isLoginOrRegister === "register"
            ? "Already a member?"
            : "Don't have an account?"}
          <button
            className="text-blue-500 hover:underline focus:outline-none"
            onClick={() =>
              setIsLoginOrRegister(
                isLoginOrRegister === "register" ? "login" : "register"
              )
            }
          >
            {isLoginOrRegister === "register" ? "Login here" : "Register here"}
          </button>
        </p>
      </form>
    </div>
  );
}
