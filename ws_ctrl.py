import asyncio
import websockets
import json
import logging


class JWS:

    def __init__(self, ws):
        self.ws = ws
        self.msg_id = 1
        self.futures = {}

    @staticmethod
    def map_arg(arg):
        if isinstance(arg, JSExpr):
            arg = str(arg)
        elif isinstance(arg, str):
            arg = "'%s'" % arg.replace("'", "\\'")
        return arg

    async def msg(self, msg):
        msg["msg_id"] = self.msg_id
        self.msg_id += 1
        logging.debug("Sending: %s", msg)
        await self.ws.send(json.dumps(msg))
        return msg["msg_id"]

    async def listen(self, obj, event_type, method="addEventListener"):
        await self.msg({"msg_type": "listen", "method": method, "obj": self.map_arg(obj), "event_type": event_type})

    async def call(self, obj, method, args):
        outargs = [self.map_arg(arg) for arg in args]
        msg = {"msg_type": "call", "obj": self.map_arg(obj), "method": method, "args": outargs}
        return await self.msg(msg)

    async def exec(self, expr):
        msg = {"msg_type": "exec", "expr": expr}
        return await self.msg(msg)

    async def eval(self, expr):
        msg = {"msg_type": "eval", "expr": expr}
        msg_id = await self.msg(msg)
        return await self.future_result(msg_id)

    async def assign(self, lhs, value):
        msg = {"msg_type": "assign", "lhs": self.map_arg(lhs), "value": value}
        return await self.msg(msg)

    async def future_result(self, msg_id):
        fut = asyncio.Future()
        self.futures[msg_id] = fut
        return await fut


class JSExpr:

    def __init__(self, e=None, jws=None):
        self.__e = e
        self.__jws = jws

    def __getattr__(self, attr):
        if self.__e is None:
            e = JSExpr(attr, self.__jws)
            return e
        else:
            self.__e += "." + attr
            return self

    async def __call__(self, *args):
        arr = str(self).rsplit(".", 1)
        if len(arr) == 1:
            obj = None
            meth = arr[0]
        else:
            obj, meth = arr
            obj = JSExpr(obj)
        return await self.__jws.call(obj, meth, args)

    def __str__(self):
        return self.__e

    def __repr__(self):
        return "JSExpr(%s)" % self.__e



async def _websocket_handler(websocket, handle_event):
    """
    Handles incoming WebSocket connections and messages.
    """
    logging.info(f"Client connected from {websocket.remote_address}")

    jws = JWS(websocket)
    js = JSExpr(None, jws)

    try:
        async for message in websocket:
            logging.debug(f"Received: {message}")
            try:
                event = json.loads(message)
            except json.JSONDecodeError:
                logging.error(f"Received non-JSON message: {message}, ignoring")
                continue

            if event["msg_type"] == "res":
                fut = jws.futures.pop(event["msg_id"], None)
                if fut is None:
                    logging.warning("Received result for msg_id=%d, but no future registered", event["msg_id"])
                else:
                    fut.set_result(event["res"])
            else:
                asyncio.create_task(handle_event(jws, js, event))

    except websockets.exceptions.ConnectionClosed as e:
        logging.info(f"Client disconnected: {e.code} - {e.reason}")
    except Exception as e:
        logging.exception(f"An unexpected error occurred: {e}")
    finally:
        logging.info(f"Connection closed with {websocket.remote_address}")


async def ws_server(user_handler, host="localhost", port=8080):
    async with websockets.serve(lambda a: _websocket_handler(a, user_handler), host, port):
        logging.info("WebSocket server started on ws://%s:%d" % (host, port))
        await asyncio.Future()  # Run forever


if __name__ == "__main__":

    async def my_handler(jws, js, event):
        print(event)
        if event["msg_type"] == "init":
            # Handle "init" event here and install listeners for needed JS events
            await jws.listen(js.document.body, "click")

    asyncio.run(ws_server(my_handler))
