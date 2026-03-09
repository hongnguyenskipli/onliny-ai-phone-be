import jwt from "jsonwebtoken";

export const verifyToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized: Missing token." });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.email || !decoded.uuid) {
      return res.status(401).json({ message: "Unauthorized: Invalid token payload." });
    }

    req.user = { uuid: decoded.uuid, email: decoded.email };
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Unauthorized: Token has expired." });
    }
    return res.status(401).json({ message: "Unauthorized: Invalid token." });
  }
};
