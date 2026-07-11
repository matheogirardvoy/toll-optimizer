import {defineStore} from "pinia";
import {Feature} from "~/composables/map/useMapbox";

interface State {
    start: Feature | null;
    end: Feature | null;
}

export const useLocationStore = defineStore('location', {
    state(): State {
        return {
            start: null,
            end: null
        }
    },
    getters: {
        getStart: state => state.start,
        getEnd: state => state.end
    },
    actions: {
        setStart(start: Feature) {
            this.start = start;
        },
        setEnd(end: Feature) {
            this.end = end;
        },
    }
});
