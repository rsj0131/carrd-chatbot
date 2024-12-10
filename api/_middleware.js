export default function middleware(req, event) {
    const headers = new Headers();

    // Add CORS headers
    headers.set("Access-Control-Allow-Origin", "*"); // Replace '*' with specific origin(s) if necessary
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");

    // Handle preflight requests (OPTIONS method)
    if (req.method === "OPTIONS") {
        return new Response(null, { headers, status: 204 }); // Respond with '204 No Content'
    }

    // Continue to the next middleware or route handler
    return fetch(req, { headers });
}
