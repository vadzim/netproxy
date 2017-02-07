#!/usr/bin/env node

require( "core-js" )
const net = require( "net" )
const fs = require( "fs" )
const os = require( "os" )
const path = require( "path" )
const url = require( "url" )
const lodash = require( "lodash" )
const stream = require( "stream" )
const Promise = require( "bluebird" )
const defaultPorts = require( "./defaultPorts" )

Promise.coroutine.addYieldHandler( Promise.resolve )

const readConfig = p => {
	let c
	try {
		c = fs.readFileSync( path.join( p, `.netproxyrc` ) )
	}
	catch ( e ) {
		return undefined
	}
	return JSON.parse( String( c ).trim() )
}

const config = function () {
	if ( process.argv.length < 3 ) {
		for ( let q, p = process.cwd(); q !== p; q = p, p = path.resolve( p, `..` ) ) {
			const c = readConfig( p )
			if ( c !== undefined )
				return c
		}
		const c = readConfig( path.join( os.homedir() ) )
		if ( c !== undefined )
			return c
	}
	const c = {}
	for ( let i = 2; i < process.argv.length; i += 2 )
		c[ process.argv[ i ] ] = process.argv[ i + 1 ]
	return c
}()

const parse = str =>
	/^\d+$/.test( str )
	? parse( `[::]:${ str }` )
	: !/:\/\//.test( str )
	? parse( `tcp://${ str }` )
	: lodash.pick( url.parse( str ), [ `protocol`, `slashes`, `auth`, `hostname`, `port`, `pathname`, `search`, `hash` ] )

const parseMultiPorts = str =>
	/(\d+\,)+\d+/.test( str )
	? str.match( /\d+/g ).map( parse )
	: [ parse( str ) ]

const parseMultiDest = str =>
	str.match( /[^,]+/g ).map( parse )

function initStreamPromise( stream ) {
	if ( stream.promise )
		throw new Error( `stream is already initialized` )
	stream.promise = new Promise( resolve => stream
		.on( `error`, error => resolve( Promise.reject( error ) ) )
		.on( `end`, () => resolve() )
	)
	return stream
}

function streamToPromise( stream ) {
	if ( !stream.promise )
		throw new Error( `A stream must be initialized by a promise immediatly after construction to avoid leaks` )
	return stream.promise
}

function connect( udest ) {
	switch ( udest.protocol ) {
		case `tcp:`: {
			return new Promise( resolve => {
				const ret = net.connect( udest.port, udest.hostname, () => resolve( ret ) )
				ret.url = udest
				initStreamPromise( ret )
				ret.on( `error`, error => resolve( Promise.reject( error ) ) )
			} )
			break
		}
		default: {
			return Promise.reject( new Error( `Unsupported protocol: ${ url.format( udest ) }` ) )
		}
	}
}

function closeStream( s ) {
	s.end()
}

function connectAny( dest ) {
	const errors = []
	return new Promise( resolve => dest.map( connect ).map( ps => ps.then( s => {
		resolve( s )
		resolve = closeStream
	} ).catch( e => {
		errors.push( e )
		e.errors = errors
		if ( errors.length === dest.length ) {
			resolve( Promise.reject( errors[ 0 ] ) )
		}
	} ) ) )
}

const pipe = Promise.coroutine( function* ( source, dest ) {
	try {
		dest = yield dest
		if ( dest ) {
			try {
				console.log(`${ url.format( source.url ) } -> ${ url.format( dest.url ) }`)
				dest.pipe( source )
				source.pipe( dest )
				yield Promise.all( [ streamToPromise( source ), streamToPromise( dest ) ] )
			}
			finally {
				dest.end()
			}
		}
	}
	finally {
		source.end()
	}
} )

for ( const [ csource, cdest ] of Object.entries( config ) ) {
	const onError = error => console.error( new Date, error )
	const usource = parseMultiPorts( csource )
	const udest = parseMultiDest( cdest )

	for ( const u of [ ...usource, ...udest ] ) {
		if ( u.port == null && u.protocol )
			u.port = defaultPorts[ u.protocol ]
		if ( u.port )
			u.port = parseInt( u.port )
		if ( u.protocol === `tcpip:` )
			u.protocol = `tcp:`
	}

	for ( const s of usource ) {
		const dest = udest.map(d => d.port == null && d.protocol === `tcp:` ? Object.assign( {}, d, { port: s.port } ) : d)
		switch ( s.protocol ) {
			case `tcp:`: {
				net.createServer(
					sourceSocket => {
						sourceSocket.url = s
						pipe( initStreamPromise( sourceSocket ), connectAny( dest ) ).catch( onError )
					}
				).on( `error`, onError ).listen( s.port )
				break
			}
			default: {
				console.error( new Date, `Unsupported protocol: ${ url.format( s ) }` )
			}
		}
		console.log( `config: ${ url.format( s ) } -> ${ dest.map( d => url.format( d ) ) }` )
	}
}
