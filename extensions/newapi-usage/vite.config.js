import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
	base: "./",
	plugins: [tailwindcss()],
	resolve: {
		alias: { "@": resolve(__dirname, "src") },
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
		rollupOptions: {
			input: {
				usage: resolve(__dirname, "popover/index.html"),
			},
		},
	},
});
