package com.jobforge;
import org.junit.jupiter.api.*;import static org.junit.jupiter.api.Assertions.*;
class BackoffTest{
 long delay(String s,long base,long cap,int a){long m=s.equals("FIXED")?1:s.equals("LINEAR")?a:(1L<<Math.min(20,a-1));return Math.min(cap,base*m);}
 @Test void fixed(){assertEquals(10,delay("FIXED",10,300,4));}
 @Test void linear(){assertEquals(40,delay("LINEAR",10,300,4));}
 @Test void exponential(){assertEquals(80,delay("EXPONENTIAL",10,300,4));}
 @Test void capped(){assertEquals(30,delay("EXPONENTIAL",10,30,8));}
}
