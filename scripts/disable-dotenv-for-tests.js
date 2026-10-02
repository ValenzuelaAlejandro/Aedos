// Prevent test processes from reading a developer's local .env file.
require('dotenv').config = () => ({ parsed: {} });
