export interface Env {
	COUNTER: DurableObjectNamespace;
	COUNTER_SHARD_MAP: DurableObjectNamespace;
}

export class CounterShardMap {
	state: DurableObjectState;
	env: Env;
  
	constructor(state: DurableObjectState, env: Env) {
	  	this.state = state;
		this.env = env;
	}
  
	async fetch(request: Request) {
		const url = new URL(request.url);
		// The client has already checked that `name` is not null
		const name = url.searchParams.get("name")!;
		const hash = this.hash(name).toString();

		let id: string | undefined = await this.state.storage.get(hash);
		if (!id) {
			id = this.env.COUNTER.newUniqueId().toString();
			await this.state.storage.put(hash, id);
		}

		return new Response(id);
	}

	hash(str: string) {
		// TODO: Do better than copying Java's String.hashCode() w/ 4 shards
		return Array.from(str).reduce((s, c) => Math.imul(31, s) + c.charCodeAt(0) | 0, 0) % 4;
	}
}

// Good ol' Counter
export class Counter {
	state: DurableObjectState;
  
	constructor(state: DurableObjectState, env: Env) {
	  	this.state = state;
	}
  
	async fetch(request: Request) {
		let url = new URL(request.url);
	
		let value: number = (await this.state.storage.get("value")) || 0;
	
		switch (url.pathname) {
			case "/increment":
				++value;
				break;
			case "/decrement":
				--value;
				break;
			case "/":
				break;
			default:
				return new Response("Not found", { status: 404 });
		}

		await this.state.storage.put("value", value);
	
		return new Response(value.toString());
	}
}

// TODO: An in-memory cache doesn't actually work here... 
let cache: Map<string, string> = new Map()

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		let url = new URL(request.url);
		let name = url.searchParams.get("name");
		if (!name) {
			return new Response(
				"Select a Durable Object to contact by using" +
				" the `name` URL query string parameter, for example, ?name=A"
			);
		}
	
		const id = await (async () => {
			if (name in cache) {
				return cache.get(name);
			} else {
				const counterShardMapId = env.COUNTER_SHARD_MAP.idFromName("shardmap");
				const counterShardMap = env.COUNTER_SHARD_MAP.get(counterShardMapId);
				const response = await counterShardMap.fetch(request);
				const id = await response.text();

				cache.set(name, id);
				return id;
			}
		})();

		if (!id) {
			return new Response("Something failed...");
		}
	
		// Did this get a new or existing counter?!
		let obj = env.COUNTER.get(env.COUNTER.idFromString(id));
	
		// Send a request to the Durable Object, then await its response.
		let resp = await obj.fetch(request.url);
		let count = await resp.text();
	
		return new Response(`Durable Object '${id}', name: '${name}', count: ${count}`);
	},
};
