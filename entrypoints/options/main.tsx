import { render } from "solid-js/web";
import { installPolyfills } from "../../src/polyfills";
import App from "./App";
import "./style.css";

installPolyfills();

render(() => <App />, document.getElementById("root")!);
