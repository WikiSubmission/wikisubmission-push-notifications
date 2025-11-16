import dotenv from "dotenv";
import { Server } from "./server";

(async () => {
    try {
        process.env.TZ = "UTC";
        
        // [Environment]
        dotenv.config();
        Server.instance.log(
            `NODE_ENV: ${process.env.NODE_ENV || 'development (default)'}`,
        );

        // [Start server]
        await Server.instance.start();
    } catch (error) {
        console.error(error);
    }
})();