<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chatbot</title>
    <style>
        /* General Reset */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        /* Chat Container */
        #chat-container {
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            width: 100%;
            max-width: 400px;
            height: 600px;
            border: 1px solid #ccc;
            border-radius: 10px;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
            overflow: hidden;
            font-family: Arial, sans-serif;
            margin: 20px auto;
        }

        /* Header */
        header {
            background-color: #4caf50;
            color: white;
            padding: 10px;
            text-align: center;
        }

        /* Chat Window */
        #chat-window {
            flex: 1;
            padding: 10px;
            overflow-y: auto;
            background-color: #f9f9f9;
        }

        /* Messages */
        #messages {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .user-message {
            align-self: flex-end;
            background-color: #4caf50;
            color: white;
            padding: 10px;
            border-radius: 10px 10px 0 10px;
            max-width: 70%;
        }

        .bot-message {
            align-self: flex-start;
            background-color: #e0e0e0;
            padding: 10px;
            border-radius: 10px 10px 10px 0;
            max-width: 70%;
        }

        /* Form */
        #chatForm {
            display: flex;
            border-top: 1px solid #ccc;
        }

        textarea {
            flex: 1;
            padding: 10px;
            border: none;
            resize: none;
            outline: none;
        }

        button {
            background-color: #4caf50;
            color: white;
            border: none;
            padding: 10px 20px;
            cursor: pointer;
            outline: none;
        }

        button:hover {
            background-color: #45a049;
        }
    </style>
</head>
<body>
    <div id="chat-container">
        <header>
            <h1>Chatbot</h1>
        </header>
        <div id="chat-window">
            <div id="messages"></div>
        </div>
        <form id="chatForm">
            <textarea id="message" placeholder="Type your message..." required></textarea>
            <button type="submit">Send</button>
        </form>
    </div>

    <script>
        document.getElementById("chatForm").addEventListener("submit", async (e) => {
            e.preventDefault();
            const message = document.getElementById("message").value;

            // Display user message
            const messagesDiv = document.getElementById("messages");
            const userMessage = document.createElement("div");
            userMessage.className = "user-message";
            userMessage.innerText = message;
            messagesDiv.appendChild(userMessage);

            messagesDiv.scrollTop = messagesDiv.scrollHeight;

            try {
                const response = await fetch("https://carrd-chatbot.vercel.app/api/reply", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ message }),
                });

                const data = await response.json();

                const botMessage = document.createElement("div");
                botMessage.className = "bot-message";
                botMessage.innerText = data.reply || "Error: " + data.error;
                messagesDiv.appendChild(botMessage);

                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            } catch (error) {
                console.error("Error:", error);
                const botMessage = document.createElement("div");
                botMessage.className = "bot-message";
                botMessage.innerText = "Error: Unable to connect to the server.";
                messagesDiv.appendChild(botMessage);

                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }

            document.getElementById("message").value = "";
        });
    </script>
</body>
</html>
