import mitt from "mitt";

type Events = {
    "routeFormMessage": { message: string, type: "error" | "warning" },
};

const emitter = mitt<Events>();

export default emitter;
