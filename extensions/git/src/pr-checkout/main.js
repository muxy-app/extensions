import { PrCheckoutApp } from "@/pr-checkout/app";
import "@/pr-checkout/pr-checkout.css";
import "@/pr-checkout/checkout-view.css";
import "@/pr-checkout/detail-view.css";

const root = document.getElementById("root");
if (root)
    new PrCheckoutApp(root).start();
