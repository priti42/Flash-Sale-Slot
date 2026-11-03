import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import reservationRoutes from "./routes/reservationRoutes";
import { errorHandler } from "./controllers/reservationController";
import Item from "./models/Item";
import { DEFAULT_CAPACITY, SALE_ITEM_NAME } from "./constants";

dotenv.config();

async function seedItem() {
  await Item.findOneAndUpdate(
    { name: SALE_ITEM_NAME },
    {
      $setOnInsert: {
        name: SALE_ITEM_NAME,
        totalCapacity: DEFAULT_CAPACITY,
        heldCount: 0,
        confirmedCount: 0,
      },
    },
    { upsert: true },
  );
}

async function main() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URI is not set");
  }

  await mongoose.connect(mongoUri);
  await seedItem();

  const app = express();
  app.use(cors({ origin: "http://localhost:5173" }));
  app.use(express.json());
  app.use("/api", reservationRoutes);
  app.use(errorHandler);

  const port = Number(process.env.PORT) || 5000;
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
