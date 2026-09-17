require("dotenv").config();

const axios = require("axios");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");


// --------------------------------------------------
// Get icons from Iconify
// --------------------------------------------------

async function getImages() {
  const requestUrl =
    "https://api.iconify.design/search?query=candy&limit=64";

  try {
    const response = await axios.get(requestUrl);

    if (!response.data || !Array.isArray(response.data.icons)) {
      throw new Error("Invalid response received from Iconify API");
    }

    const iconNames = response.data.icons;

    // We need at least 57 icons for createDeck(8).
    if (iconNames.length < 57) {
      throw new Error(
        `Iconify returned only ${iconNames.length} icons. Need at least 57.`
      );
    }

    // Use exactly 57 icons, as the original Iconfinder
    // implementation did.
    return iconNames.slice(0, 57).map((iconName) => {
      const [prefix, name] = iconName.split(":");

      if (!prefix || !name) {
        throw new Error(`Invalid Iconify icon name: ${iconName}`);
      }

      return {
        src: `https://api.iconify.design/${prefix}/${name}.svg`,
        alt: name,
      };
    });
  } catch (err) {
    console.error("Failed to get icons from Iconify:");

    if (err.response) {
      console.error("HTTP status:", err.response.status);
      console.error("Response:", err.response.data);
    } else {
      console.error(err.message);
    }

    throw err;
  }
}


// --------------------------------------------------
// Shuffle
// --------------------------------------------------

function shuffle(arr) {
  const shuffledArr = [...arr];

  for (let i = shuffledArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [shuffledArr[i], shuffledArr[j]] = [
      shuffledArr[j],
      shuffledArr[i],
    ];
  }

  return shuffledArr;
}


// --------------------------------------------------
// Create Dobble deck
// --------------------------------------------------

function createDeck(n, images) {
  const cards = [];

  for (let crd = 0; crd < n; crd++) {
    const symbols = [images[0]];

    for (let sym = 1; sym < n; sym++) {
      symbols.push(images[crd * (n - 1) + sym]);
    }

    cards.push(symbols.slice());
  }

  for (let cat = 1; cat < n; cat++) {
    for (let crd = 0; crd < n - 1; crd++) {
      const symbols = [images[cat]];

      for (let sym = 1; sym < n; sym++) {
        symbols.push(
          images[
            1 +
              sym * (n - 1) +
              (((cat - 1) * (sym - 1) + crd) % (n - 1))
          ]
        );
      }

      cards.push(symbols.slice());
    }
  }

  return cards;
}


// --------------------------------------------------
// Express / HTTP / Socket.IO
// --------------------------------------------------

const app = express();

const PORT = process.env.PORT;

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "https://dobble-online.netlify.app",
    methods: ["GET", "POST"],
  },
});

app.use(express.json());


// --------------------------------------------------
// Game state
// --------------------------------------------------

let shuffledDeck = null;
let lastCard = null;
let clicks = 0;

const players = [];

let startTimeout = null;


// --------------------------------------------------
// Initialize game
// --------------------------------------------------

async function initializeGame() {
  console.log("Initializing game...");

  const imagesArray = await getImages();

  console.log(
    `Successfully loaded ${imagesArray.length} icons.`
  );

  const deck = createDeck(8, imagesArray);

  console.log(
    `Created deck with ${deck.length} cards.`
  );

  shuffledDeck = shuffle(deck);

  console.log(
    `Deck shuffled. ${shuffledDeck.length} cards available.`
  );
}


// --------------------------------------------------
// Check winner
// --------------------------------------------------

const checkWinner = () => {
  let winner = [{ name: "", score: 0 }];

  for (const player of players) {
    if (player.score > winner[0].score) {
      winner = [player];
    } else if (player.score === winner[0].score) {
      winner.push(player);
    }
  }

  io.emit("winner", winner);
};


// --------------------------------------------------
// Socket.IO connection
// --------------------------------------------------

io.on("connection", (socket) => {
  console.log(
    "New Websocket connection:",
    socket.id
  );


  // ------------------------------------------------
  // Set username
  // ------------------------------------------------

  socket.on("setUsername", (username) => {

    // Prevent duplicate registration of the same socket.
    const existingPlayer = players.find(
      (player) => player.id === socket.id
    );

    if (existingPlayer) {
      return;
    }

    players.push({
      id: socket.id,
      name: username,
      score: 0,
    });

    io.emit("playersState", players);

    console.log(
      `Player joined: ${username}. Players: ${players.length}`
    );


    // Start game when there are exactly 2 players.
    if (players.length === 2) {

      if (!Array.isArray(shuffledDeck)) {
        console.error(
          "Cannot start game: shuffledDeck is not initialized."
        );
        return;
      }

      // Cancel an existing countdown.
      if (startTimeout) {
        clearTimeout(startTimeout);
        startTimeout = null;
      }

      const startTime = Date.now() + 3000;

      io.emit("startCountdown", startTime);

      console.log("Game countdown started.");

      startTimeout = setTimeout(() => {

        startTimeout = null;

        // Make sure both players are still connected.
        if (players.length !== 2) {
          console.log(
            "Game start cancelled: no longer 2 players."
          );
          return;
        }

        // We need at least 3 cards:
        // one common card + one card for each player.
        if (shuffledDeck.length < 3) {
          console.error(
            "Not enough cards to start the game."
          );

          checkWinner();
          return;
        }

        // Draw common card.
        lastCard = shuffledDeck.pop();

        io.emit("deckState", lastCard);

        // Draw one card for every player.
        players.forEach((player) => {
          io.to(player.id).emit(
            "drawnCard",
            shuffledDeck.pop()
          );
        });

        // Start the game ONCE.
        io.emit("startGame");

        console.log("Game started.");
      }, 3000);
    }
  });


  // ------------------------------------------------
  // Get deck
  // ------------------------------------------------

  socket.on("getDeck", () => {
    socket.emit(
      "deckState",
      shuffledDeck
    );
  });


  // ------------------------------------------------
  // Get players
  // ------------------------------------------------

  socket.on("getPlayers", () => {
    socket.emit(
      "playersState",
      players
    );
  });


  // ------------------------------------------------
  // Update score
  // ------------------------------------------------

  socket.on("updateScore", () => {

    if (clicks === 0) {

      const player = players.find(
        (player) => player.id === socket.id
      );

      if (!player) {
        return;
      }

      player.score++;

      socket.emit(
        "playersState",
        players
      );

      io.emit(
        "message",
        `נקודה ל${player.name}!`
      );

      clicks++;
    }
  });


  // ------------------------------------------------
  // Next card
  // ------------------------------------------------

  socket.on("nextCard", () => {

    clicks = 0;

    if (!Array.isArray(shuffledDeck)) {
      console.error(
        "Cannot draw next card: shuffledDeck is not initialized."
      );
      return;
    }

    if (shuffledDeck.length >= 2) {

      const newDeckCard =
        shuffledDeck.pop();

      io.emit(
        "deckState",
        newDeckCard
      );

      const player = players.find(
        (player) => player.id === socket.id
      );

      if (!player) {
        return;
      }

      // Give the player who clicked
      // the previous common card.
      io.to(player.id).emit(
        "drawnCard",
        lastCard
      );

      // Give the other players a new card.
      const restOfPlayers =
        players.filter(
          (pl) => pl.id !== socket.id
        );

      restOfPlayers.forEach((pla) => {
        io.to(pla.id).emit(
          "drawnCard",
          shuffledDeck.pop()
        );
      });

      lastCard = newDeckCard;

    } else {

      checkWinner();
    }
  });


  // ------------------------------------------------
  // Disconnect
  // ------------------------------------------------

  socket.on("disconnect", () => {

    console.log(
      "Websocket disconnected:",
      socket.id
    );

    const index = players.findIndex(
      (player) => player.id === socket.id
    );

    if (index !== -1) {
      players.splice(index, 1);
    }

    // Cancel countdown if a player leaves.
    if (
      startTimeout &&
      players.length < 2
    ) {
      clearTimeout(startTimeout);
      startTimeout = null;

      console.log(
        "Game countdown cancelled."
      );
    }

    io.emit(
      "playersState",
      players
    );
  });
});


// --------------------------------------------------
// Start server only after initialization
// --------------------------------------------------

initializeGame()
  .then(() => {

    server.listen(PORT, () => {
      console.log(
        "connection succeeded!"
      );

      console.log(
        `Server listening on port ${PORT}`
      );
    });

  })
  .catch((err) => {

    console.error(
      "Failed to initialize game."
    );

    console.error(err);

    // Do not start a broken server.
    process.exit(1);
  });


// --------------------------------------------------
// Optional routes
// --------------------------------------------------

// app.use("/games", require("./Routes/gameRouter"));
// app.use("/users", require("./Routes/userRouter"));
// require("./DL/db").myConnect();