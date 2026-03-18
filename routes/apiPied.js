require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const axios = require("axios");

async function getPied(code) {
  try {
    const response = await axios.get(`${process.env.PIED_API_URL}/pied`, {
      params: { code: String(code) },
      headers: {
        Authorization:
          `Bearer ${process.env.PIED_API_KEY}`,
      },
      timeout: 120000,  
      proxy: false,  
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: () => true, 
    });

    if (response.status >= 400) {
      throw new Error(
        `Pied respondeu ${response.status}: ${JSON.stringify(response.data).slice(0, 500)}`
      );
    }

    return response.data;
  } catch (err) {
    // log certo do Axios
    const e = err;
    console.log("[getPied][ERR]", {
      message: e.message,
      code: e.code,
      errno: e.errno,
      syscall: e.syscall,
      address: e.address,
      port: e.port,
      status: e.response?.status,
      data: e.response?.data,
      url: e.config?.url,
      params: e.config?.params,
      timeout: e.config?.timeout,
      http_proxy: process.env.HTTP_PROXY,
      https_proxy: process.env.HTTPS_PROXY,
      no_proxy: process.env.NO_PROXY,
    });
    throw err;
  }
}

module.exports = { getPied };